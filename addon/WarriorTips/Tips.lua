-- Warrior Tips: live tips during combat.
--
-- Everything here works only from data Forever lets addons read. Where a value
-- is secret in combat we fall back to a snapshot taken just before the combat
-- restriction turns on (ADDON_RESTRICTION_STATE_CHANGED fires before it is
-- enforced), or the tip simply stays quiet.

local _, WT = ...

-- Reactive abilities checked each tick (a constant, so the tick makes no new table).
local REACTIVE = { "Overpower", "Revenge" }

local TICK = 0.25
local BIG_COOLDOWNS = { "Death Wish", "Recklessness", "Blood Fury" }

local ticker
local snap = { at = 0, ready = {} }   -- last pre-combat snapshot

local function takeSnapshot()
  snap.at = GetTime()
  for _, name in ipairs(BIG_COOLDOWNS) do
    snap.ready[name] = WT.Knows(name) and WT.CooldownLeft(name) == 0 or nil
  end
  local left = WT.ShoutLeft()
  snap.shoutExpires = left and (GetTime() + left) or nil
  snap.shoutDuration = nil
  local id = WT.spells["Battle Shout"]
  if id and left and left > 0 then
    snap.shoutDuration = WT.ReadField("duration", C_UnitAuras.GetPlayerAuraBySpellID, id)
  end
end

-- Is this cooldown ready? Live read if possible, else the snapshot for the first 15s of the fight.
local function isReady(name)
  if not WT.Knows(name) then return false end
  local left = WT.CooldownLeft(name)
  if left ~= nil then return left == 0 end
  local f = WT.fight
  return f and snap.ready[name] and GetTime() - f.start < 15 or false
end

local function readyList(names)
  local out = {}
  for _, n in ipairs(names) do if isReady(n) then table.insert(out, n) end end
  return out
end

local function targetWorthIt()
  if not UnitExists("target") or not WT.Read(UnitCanAttack, "player", "target") then return false end
  if WT.TargetIsBoss() then return true end
  local cls = WT.Read(UnitClassification, "target")
  return cls == "elite" or cls == "rareelite"
end

local function bossPull(f)
  if f.bossAnnounced then return end
  f.bossAnnounced, f.boss = true, true
  local ready = readyList({ "Death Wish", "Blood Fury" })
  f.readyAtPull = {}
  for _, n in ipairs(BIG_COOLDOWNS) do f.readyAtPull[n] = isReady(n) end
  if #ready > 0 then
    WT.Tip("cooldowns", "Boss pull: " .. table.concat(ready, " + ") .. " ready", 60)
  end
end

local function shoutLeft(f)
  local live = WT.ShoutLeft()
  if live ~= nil then f.shoutLive = true; return live end
  -- Snapshot-based estimate, only trusted while we can see our own casts.
  if f.castsVisible and f.shoutExpires then return math.max(0, f.shoutExpires - GetTime()) end
  return nil
end

local function tick()
  local f = WT.fight
  if not f then return end
  local now = GetTime()

  -- Boss detection by target, for bosses that don't fire ENCOUNTER_START.
  if not f.bossAnnounced and WT.TargetIsBoss() then bossPull(f) end

  -- Execute phase: Execute turns usable when the target drops under 20%.
  local exec = WT.UsableIgnoringRage("Execute")
  if exec ~= nil then
    if exec and f.prevExec == false and targetWorthIt() then
      f.executeSeen = true
      local msg = "Execute phase: Execute is your main button now"
      if f.boss then
        local ready = readyList({ "Recklessness", "Death Wish" })
        if #ready > 0 then msg = "Execute phase: " .. table.concat(ready, " + ") .. " ready, then Execute" end
      end
      WT.Tip("execute", msg, 30)
    end
    f.prevExec = exec
  end

  -- Rage capping: only when rage is readable in combat.
  local rage = WT.Rage()
  if rage ~= nil then
    f.rageSamples = f.rageSamples + 1
    if rage >= WT.db.rageCap then
      f.rageCapped = f.rageCapped + 1
      f.capSince = f.capSince or now
      if now - f.capSince >= 1.5 then
        WT.Tip("rage", "Rage capped: queue Heroic Strike (Cleave on packs)", 15)
      end
    else
      f.capSince = nil
    end
  end

  -- Battle Shout missing or about to drop.
  local left = shoutLeft(f)
  if left ~= nil and WT.Knows("Battle Shout") then
    if left == 0 then
      f.shoutMissing = f.shoutMissing + TICK
      if now - f.start > 2 then WT.Tip("shout", "Battle Shout is down: recast it", 45, "shoutDown") end
    elseif left <= 5 then
      WT.Tip("shout", ("Battle Shout drops in %ds"):format(math.ceil(left)), 45, "shoutSoon")
    end
  end

  -- Reactive abilities (off by default).
  for _, n in ipairs(REACTIVE) do
    local id = WT.spells[n]
    if id then
      local usable = WT.Read(C_Spell.IsSpellUsable, id)
      local key = "prev" .. n
      if usable and f[key] == false then WT.Tip("reactive", n .. "!", 5) end
      if usable ~= nil then f[key] = usable end
    end
  end
end

local function startFight()
  if WT.fight then return end
  if GetTime() - snap.at > 3 then takeSnapshot() end
  WT.fight = {
    start = GetTime(), tips = {}, prevExec = false, rageSamples = 0, rageCapped = 0, shoutMissing = 0,
    shoutExpires = snap.shoutExpires, shoutDuration = snap.shoutDuration,
  }
  if ticker then ticker:Cancel() end
  ticker = C_Timer.NewTicker(TICK, function()
    local ok, err = pcall(tick)
    if not ok and WT.debug then WT.Print("tick error: " .. tostring(err)) end
  end)
end

local function endFight()
  if ticker then ticker:Cancel(); ticker = nil end
  local f = WT.fight
  WT.fight = nil
  if f then
    f.stop = GetTime()
    if WT.OnFightEnd then WT.OnFightEnd(f) end
  end
end

-- Fires just before combat/encounter restrictions are enforced: our last clean look.
WT.On("ADDON_RESTRICTION_STATE_CHANGED", function(_, rtype, state)
  if Enum.AddOnRestrictionState and state == Enum.AddOnRestrictionState.Activating then takeSnapshot() end
end)

WT.On("PLAYER_REGEN_DISABLED", startFight)
WT.On("PLAYER_REGEN_ENABLED", endFight)
WT.On("ENCOUNTER_START", function()
  startFight()
  bossPull(WT.fight)
end)

WT.On("PLAYER_TARGET_CHANGED", function()
  -- A new target already under 20% should still count as a fresh Execute phase.
  if WT.fight then WT.fight.prevExec = false end
end)

-- Track our own Battle Shout casts when the spell id is readable.
WT.On("UNIT_SPELLCAST_SUCCEEDED", function(_, unit, _, spellID)
  local f = WT.fight
  if not f or unit ~= "player" then return end
  if WT.IsSecret(spellID) then f.castsVisible = false; return end
  if f.castsVisible == nil then f.castsVisible = true end
  if spellID == WT.spells["Battle Shout"] then
    f.shoutExpires = GetTime() + (f.shoutDuration or 120)
  end
end)
