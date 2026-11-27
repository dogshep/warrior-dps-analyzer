-- Warrior Tips: live tips during combat.
--
-- What Forever lets addons read in combat (from /wtips probe, 2026-11-27):
--   readable: spell usability (Execute, Overpower...), target classification,
--             the spell id of our own casts (UNIT_SPELLCAST_SUCCEEDED)
--   secret:   rage, health, cooldowns, auras (Battle Shout comes back nil)
-- So cooldowns and Battle Shout are tracked from a clean read just before
-- combat restrictions switch on plus our own casts, and rage capping is shown
-- by a display-only indicator driven by a color curve (the game fills in the
-- color from the secret value; our code never sees the number).

local _, WT = ...

local REACTIVE = { "Overpower", "Revenge" }
local TICK = 0.25
local BIG_COOLDOWNS = { "Death Wish", "Recklessness", "Blood Fury", "Bloodrage" }
local SHOUT_DEFAULT = 120

local ticker
local shout = { expires = nil, duration = nil }   -- Battle Shout tracker

-- Clean look at cooldowns and Battle Shout. Runs whenever values are readable:
-- just before restrictions turn on, out of combat, and after combat.
local function sync()
  for _, name in ipairs(BIG_COOLDOWNS) do WT.SyncCooldown(name) end
  for name in pairs(WT.CD_BASE) do WT.SyncCooldown(name) end
  local left = WT.ShoutLeft()
  if left ~= nil then
    shout.expires = GetTime() + left
    local id = WT.spells["Battle Shout"]
    if id and left > 0 then
      local dur = WT.ReadField("duration", C_UnitAuras.GetPlayerAuraBySpellID, id)
      if dur and dur > 0 then shout.duration = dur end
    end
  end
end
WT.Sync = sync

local function isReady(name)
  return WT.Knows(name) and WT.CooldownLeftTracked(name) == 0
end

local function readyList(names)
  local out = {}
  for _, n in ipairs(names) do if isReady(n) then out[#out + 1] = n end end
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
  f.readyAtPull = {}
  for _, n in ipairs(BIG_COOLDOWNS) do f.readyAtPull[n] = isReady(n) end
  local ready = readyList({ "Death Wish", "Blood Fury" })
  if #ready > 0 then
    WT.Tip("cooldowns", "Boss pull: " .. table.concat(ready, " + ") .. " ready", 60)
  end
end

local function shoutLeft()
  local live = WT.ShoutLeft()
  if live ~= nil then
    shout.expires = GetTime() + live
    return live
  end
  if shout.expires then return math.max(0, shout.expires - GetTime()) end
  return nil
end

---------------------------------------------------------------------------
-- Rage indicator: a second line under the tips. When rage is secret its color
-- comes from UnitPowerPercent with a step color curve that is transparent
-- below the cap and gold at or above it.
---------------------------------------------------------------------------
local rageLabel, rageHolder, rageCurve, rageCurveKey, previewUntil = nil, nil, nil, nil, 0

local function rageRGB()
  local c = WT.db and WT.db.rageColor or { 1, 0.82, 0.3 }
  return c[1], c[2], c[3]
end

local function rageIndicator()
  if rageLabel then return rageLabel end
  -- Its own frame: the tip frame hides between tips, this line must not.
  local holder = CreateFrame("Frame", "WarriorTipsRageFrame", UIParent)
  rageHolder = holder
  holder:SetSize(300, 20)
  holder:SetPoint("TOP", _G.WarriorTipsFrame, "BOTTOM", 0, -2)
  rageLabel = holder:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  rageLabel:SetPoint("CENTER")
  rageLabel:SetText("Rage capped: Heroic Strike")
  local r, g, b = rageRGB()
  rageLabel:SetTextColor(r, g, b, 0)
  return rageLabel
end

function WT.StyleRage(font, size)
  local label = rageIndicator()
  pcall(label.SetFont, label, font, size, "OUTLINE")
  rageHolder:SetSize(math.max(300, size * 22), size + 6)
  rageCurve = nil   -- the color lives in the curve: rebuild it
end

-- Show the rage line at full color for a few seconds (after a style change).
function WT.PreviewRage(sec)
  local label = rageIndicator()
  local r, g, b = rageRGB()
  label:SetTextColor(r, g, b, 1)
  previewUntil = GetTime() + sec
  C_Timer.After(sec, function()
    if GetTime() >= previewUntil and not WT.fight then label:SetTextColor(r, g, b, 0) end
  end)
end

local function curveForCap(cap)
  local r, g, b = rageRGB()
  local key = ("%d:%.3f:%.3f:%.3f"):format(cap, r, g, b)
  if rageCurve and rageCurveKey == key then return rageCurve end
  if not (C_CurveUtil and C_CurveUtil.CreateColorCurve and CreateColor) then return nil end
  local ok, curve = pcall(C_CurveUtil.CreateColorCurve)
  if not ok or not curve then return nil end
  pcall(curve.SetType, curve, Enum.LuaCurveType.Step)
  curve:AddPoint(0, CreateColor(r, g, b, 0))
  curve:AddPoint(cap / 100, CreateColor(r, g, b, 1))
  rageCurve, rageCurveKey = curve, key
  return curve
end

local function hideRage()
  if rageLabel then local r, g, b = rageRGB(); rageLabel:SetTextColor(r, g, b, 0) end
end

-- Returns true if the display-only indicator is in use (rage is secret).
local function updateRageIndicator()
  local db = WT.db
  if not db.enabled or not db.tips.rage then hideRage(); return false end
  local label = rageIndicator()
  local curve = curveForCap(db.rageCap)
  if not label or not curve then return false end
  local ok, color = pcall(UnitPowerPercent, "player", Enum.PowerType.Rage, false, curve)
  if not ok or color == nil then hideRage(); return false end
  local okRGBA = pcall(function() label:SetTextColor(color:GetRGBA()) end)
  if not okRGBA then hideRage(); return false end
  return true
end

---------------------------------------------------------------------------

local function tick()
  local f = WT.fight
  if not f then return end
  local now = GetTime()

  if not f.bossAnnounced and WT.TargetIsBoss() then bossPull(f) end

  -- Execute phase: Execute turns usable when the target drops under 20%.
  local exec = WT.UsableIgnoringRage("Execute")
  if exec ~= nil then
    if exec and f.prevExec == false and targetWorthIt() then
      if not f.execStart then f.execStart = now end
      local msg = "Execute phase: Execute is your main button now"
      if f.boss then
        local ready = readyList({ "Recklessness", "Death Wish" })
        if #ready > 0 then msg = "Execute phase: " .. table.concat(ready, " + ") .. " ready, then Execute" end
      end
      WT.Tip("execute", msg, 30)
    end
    f.prevExec = exec
  end

  -- Big cooldown back mid boss fight.
  if f.boss then
    for _, n in ipairs({ "Death Wish", "Blood Fury" }) do
      local ready = isReady(n)
      if ready and f.wasReady[n] == false and now - f.start > 10 then
        WT.Tip("cooldowns", n .. " is ready again", 30, "back" .. n)
      end
      f.wasReady[n] = ready
    end
  end

  -- Rage capping: a real tip when rage is readable, else the indicator.
  local rage = WT.Rage()
  if rage ~= nil then
    hideRage()
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
  else
    updateRageIndicator()
  end

  -- Battle Shout missing or about to drop.
  local left = WT.Knows("Battle Shout") and shoutLeft() or nil
  if left ~= nil then
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
  sync()
  WT.fight = {
    start = GetTime(), tips = {}, prevExec = false, rageSamples = 0, rageCapped = 0, shoutMissing = 0,
    casts = {}, execCasts = 0, wasReady = {},
  }
  if ticker then ticker:Cancel() end
  ticker = C_Timer.NewTicker(TICK, function()
    local ok, err = pcall(tick)
    if not ok and WT.debug then WT.Print("tick error: " .. tostring(err)) end
  end)
end

local function endFight()
  if ticker then ticker:Cancel(); ticker = nil end
  hideRage()
  local f = WT.fight
  WT.fight = nil
  if f then
    f.stop = GetTime()
    C_Timer.After(0.5, sync)
    if WT.OnFightEnd then WT.OnFightEnd(f) end
  end
end

-- Fires just before combat/encounter restrictions are enforced: our last clean look.
WT.On("ADDON_RESTRICTION_STATE_CHANGED", function(_, _, state)
  if Enum.AddOnRestrictionState and state == Enum.AddOnRestrictionState.Activating then sync() end
end)

WT.On("PLAYER_REGEN_DISABLED", startFight)
WT.On("PLAYER_REGEN_ENABLED", endFight)
WT.On("PLAYER_ENTERING_WORLD", function() C_Timer.After(2, sync) end)
WT.On("ENCOUNTER_START", function()
  startFight()
  bossPull(WT.fight)
end)

WT.On("PLAYER_TARGET_CHANGED", function()
  -- A new target already under 20% should still count as a fresh Execute phase.
  if WT.fight then WT.fight.prevExec = false end
end)

-- Our own casts: readable on Forever even in combat.
local nameById = {}
WT.On("UNIT_SPELLCAST_SUCCEEDED", function(_, unit, _, spellID)
  if unit ~= "player" or WT.IsSecret(spellID) then return end
  if nameById.stale ~= false then
    wipe(nameById)
    for n, id in pairs(WT.spells) do nameById[id] = n end
    nameById.stale = false
  end
  local name = nameById[spellID]
  if name == "Battle Shout" then shout.expires = GetTime() + (shout.duration or SHOUT_DEFAULT) end
  if name and WT.CD_BASE[name] then
    WT.NoteCast(name)
    -- Out of combat the real cooldown is readable a moment later.
    if not WT.fight then C_Timer.After(0.2, function() WT.SyncCooldown(name) end) end
  end
  local f = WT.fight
  if f then
    f.casts[spellID] = (f.casts[spellID] or 0) + 1
    if name == "Execute" then f.execCasts = f.execCasts + 1 end
  end
end)
WT.On("SPELLS_CHANGED", function() nameById.stale = true end)
WT.RageIndicatorWorks = function()
  local label, curve = rageIndicator(), curveForCap(WT.db.rageCap)
  if not label or not curve then return "no curve API" end
  local ok, err = pcall(function()
    label:SetTextColor(UnitPowerPercent("player", Enum.PowerType.Rage, false, curve):GetRGBA())
  end)
  hideRage()
  return ok and "works" or ("error: " .. tostring(err):sub(1, 60))
end
