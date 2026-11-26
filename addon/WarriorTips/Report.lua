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

local function usedDuring(name, f)
  local start = WT.CooldownStart(name)
  if start == nil then return nil end
  return start > 0 and start >= f.start - 1
end

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
    if f.executeSeen then
      local exec = 0
      for _, s in ipairs(meter.spells) do if s.id == WT.spells["Execute"] then exec = s.amount end end
      if exec == 0 then
        table.insert(advice, "Execute phase came but Execute did no damage. Below 20% it is your main button.")
      end
    end
  else
    table.insert(lines, ("%s%s (no damage breakdown: %s)"):format(f.boss and "Boss fight " or "Fight ", fmtTime(dur), why))
  end

  -- Cooldowns: only judged on bosses (dungeon trash pace decides whether they are back).
  if f.boss and f.readyAtPull then
    for _, name in ipairs({ "Death Wish", "Recklessness" }) do
      if f.readyAtPull[name] then
        local used = usedDuring(name, f)
        if used == false then
          table.insert(advice, name .. " was ready on this boss and not used.")
        elseif used and name == "Death Wish" then
          table.insert(lines, "Death Wish used.")
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
end

function WT.OnFightEnd(f)
  if WT.OnProbeFightEnd then WT.OnProbeFightEnd(f) end
  local db = WT.db
  if not db or not WT.isWarrior or db.report == "off" then return end
  local dur = f.stop - f.start
  if db.report == "boss" and not f.boss then return end
  if dur < 15 then return end
  -- The meter needs a moment after combat to settle.
  C_Timer.After(1.5, function()
    local ok, err = pcall(report, f)
    if not ok and WT.debug then WT.Print("report error: " .. tostring(err)) end
  end)
end
