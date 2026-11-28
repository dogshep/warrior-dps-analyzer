-- Warrior Tips: a short report card in chat after a fight.
--
-- Built from Blizzard's own damage meter (C_DamageMeter), which is secret in
-- combat but readable once combat ends, plus what the live tips saw.
-- The rules mirror the web analyzer (web/js/analyze.js) where the data allows.

local _, WT = ...

local function fmtTime(sec)
  sec = math.floor(sec + 0.5)
  return ("%d:%02d"):format(math.floor(sec / 60), sec % 60)
end

local function spellName(id)
  local name = WT.Read(C_Spell.GetSpellName, id)
  return name or ("spell " .. tostring(id))
end

-- Player's damage by spell for the fight that just ended, or nil plus a reason.
local function meterBreakdown()
  if not C_DamageMeter then return nil, "this client has no damage meter API" end
  local ok, available, why = pcall(C_DamageMeter.IsDamageMeterAvailable)
  if ok and available == false then return nil, why ~= "" and why or "the damage meter is off" end
  local src = WT.Read(C_DamageMeter.GetCombatSessionSourceFromType,
    Enum.DamageMeterSessionType.Current, Enum.DamageMeterType.DamageDone, UnitGUID("player"))
  if type(src) ~= "table" or type(src.combatSpells) ~= "table" then return nil, "no meter data for this fight" end
  local total = src.totalAmount
  if WT.IsSecret(total) or not total or total <= 0 then return nil, "meter data still hidden" end
  local spells = {}
  for _, s in ipairs(src.combatSpells) do
    if not WT.IsSecret(s.totalAmount) and not WT.IsSecret(s.spellID) and s.totalAmount > 0 then
      table.insert(spells, { id = s.spellID, name = spellName(s.spellID), amount = s.totalAmount })
    end
  end
  table.sort(spells, function(a, b) return a.amount > b.amount end)
  return { total = total, spells = spells }
end

-- "1 cast", "3 casts"
local function count(n, word) return ("%d %s%s"):format(n, word, n == 1 and "" or "s") end

local function castsOf(f, name)
  local id = WT.spells[name]
  return id and f.casts[id] or 0
end

-- Used during the fight? Our own casts are readable on Forever; fall back to the cooldown start.
local function usedDuring(name, f)
  if castsOf(f, name) > 0 then return true end
  local start = WT.CooldownStart(name)
  if start == nil then return next(f.casts) and false or nil end
  return start > 0 and start >= f.start - 1
end

-- Main attacks on a short cooldown: how many casts out of how many possible.
local MAIN_ATTACKS = { "Bloodthirst", "Mortal Strike", "Whirlwind" }
local debugReport   -- defined below
local function report(f)
  local dur = f.stop - f.start
  local lines, advice = {}, {}

  local meter, why = meterBreakdown()
  if meter then
    local parts = {}
    for i = 1, math.min(4, #meter.spells) do
      local s = meter.spells[i]
      table.insert(parts, ("%s %d%%"):format(s.name, math.floor(s.amount / meter.total * 100 + 0.5)))
    end
    table.insert(lines, ("%s%s, %d DPS. %s"):format(f.boss and "Boss fight " or "Fight ", fmtTime(dur),
      math.floor(meter.total / math.max(dur, 1)), table.concat(parts, ", ")))
  else
    table.insert(lines, ("%s%s (no damage breakdown: %s)"):format(f.boss and "Boss fight " or "Fight ", fmtTime(dur), why))
  end

  -- Execute phase: how many Executes from the first Execute window to the end.
  if f.execStart then
    local execDur = f.stop - f.execStart
    table.insert(lines, ("Execute phase %ds: %s."):format(math.floor(execDur + 0.5), count(f.execCasts, "Execute")))
    if f.execCasts == 0 and execDur > 4 then
      table.insert(advice, "The Execute phase came but you never cast Execute. Below 20% it is your main button.")
    end
  end

  -- Main attacks, judged outside the Execute phase only.
  local active = (f.execStart or f.stop) - f.start
  if active > 30 then
    for _, name in ipairs(MAIN_ATTACKS) do
      local n, len = castsOf(f, name), WT.CooldownLength(name)
      if n > 0 and len then
        local possible = math.floor(active / len) + 1
        if n / possible < 0.7 then
          table.insert(advice, ("%s: %s, about %d possible. Press it the moment it comes off cooldown.")
            :format(name, count(n, "cast"), possible))
        end
      end
    end
  end

  -- Cooldowns: only judged on bosses (dungeon trash pace decides whether they are back).
  if f.boss and f.readyAtPull then
    for _, name in ipairs({ "Death Wish", "Recklessness" }) do
      if f.readyAtPull[name] then
        local used = usedDuring(name, f)
        if used == false then
          table.insert(advice, name .. " was ready on this boss and not used.")
        elseif used then
          table.insert(lines, ("%s used%s."):format(name,
            castsOf(f, name) > 1 and (" " .. castsOf(f, name) .. " times") or ""))
        end
      end
    end
  end

  if f.rageSamples > 8 then
    local pct = f.rageCapped / f.rageSamples
    if pct > 0.08 then
      table.insert(advice, ("You sat at %d+ rage %d%% of the fight. Queue Heroic Strike (Cleave on packs) when rage is high.")
        :format(WT.db.rageCap, math.floor(pct * 100 + 0.5)))
    end
  end

  if f.shoutMissing > 0 and dur > 20 and f.shoutMissing / dur > 0.1 then
    table.insert(advice, ("Battle Shout was down for about %ds. Refresh it before it drops."):format(math.floor(f.shoutMissing)))
  end

  for _, l in ipairs(lines) do WT.Print(l) end
  for _, a in ipairs(advice) do WT.Print("|cffffd100Tip:|r " .. a) end
  if WT.debug then debugReport(f, meter) end
end

-- Debug mode: everything the addon saw, whatever the fight.
function debugReport(f, meter)
  local P = function(s) WT.Print("|cff88ccff[debug]|r " .. s) end
  local dur = f.stop - f.start
  P(("fight %.1fs, boss %s, tips shown: %s"):format(dur, tostring(f.boss or false),
    #f.tips > 0 and table.concat(f.tips, ", ") or "none"))
  if meter then
    local parts = {}
    for _, s in ipairs(meter.spells) do
      parts[#parts + 1] = ("%s %d (%d%%)"):format(s.name, s.amount, math.floor(s.amount / meter.total * 100 + 0.5))
    end
    P("damage: " .. table.concat(parts, ", "))
  end
  local casts = {}
  for id, n in pairs(f.casts) do casts[#casts + 1] = { name = spellName(id), n = n } end
  table.sort(casts, function(a, b) return a.n > b.n end)
  local parts = {}
  for _, c in ipairs(casts) do parts[#parts + 1] = c.name .. " " .. c.n end
  P("casts: " .. (#parts > 0 and table.concat(parts, ", ") or "none seen"))
  local execAt = f.execStart or f.execStartAny
  P(execAt and ("execute phase from %.0fs (%s target), %s"):format(execAt - f.start,
    f.execStart and "boss/elite" or "normal", count(f.execCasts, "Execute")) or "execute phase: not seen")
  local active = (execAt or f.stop) - f.start
  for _, name in ipairs(MAIN_ATTACKS) do
    if WT.Knows(name) then
      local len = WT.CooldownLength(name)
      P(("%s: %s, about %d possible in %.0fs (cooldown %ss)"):format(name, count(castsOf(f, name), "cast"),
        math.floor(active / len) + 1, active, tostring(len)))
    end
  end
  for _, name in ipairs(WT.BIG_COOLDOWNS) do
    if WT.Knows(name) then
      local atPull = f.pullReady[name]
      local now = WT.CooldownLeftTracked(name)
      P(("%s: at pull %s, used %s, now %s, length %ss"):format(name,
        atPull == nil and "unknown" or atPull == 0 and "ready" or ("%ds left"):format(atPull),
        count(castsOf(f, name), "time"), now == nil and "unknown" or now == 0 and "ready" or ("%ds left"):format(now),
        tostring(WT.CooldownLength(name))))
    end
  end
  if f.rageSamples > 0 then
    P(("rage readable: %d samples, %d at the cap"):format(f.rageSamples, f.rageCapped))
  else
    P("rage secret all fight; indicator " .. (f.rageIndicator and "drawn" or "not drawn"))
  end
  P(("Battle Shout: %s, down about %ds"):format(f.shoutSource or "not tracked", math.floor(f.shoutMissing)))
end

function WT.OnFightEnd(f)
  if WT.OnProbeFightEnd then WT.OnProbeFightEnd(f) end
  local db = WT.db
  if not db or not WT.isWarrior then return end
  local dur = f.stop - f.start
  if not WT.debug then
    if db.report == "off" then return end
    if db.report == "boss" and not f.boss then return end
    if dur < 15 then return end
  end
  -- The meter needs a moment after combat to settle.
  C_Timer.After(1.5, function()
    local ok, err = pcall(report, f)
    if not ok and WT.debug then WT.Print("report error: " .. tostring(err)) end
  end)
end
