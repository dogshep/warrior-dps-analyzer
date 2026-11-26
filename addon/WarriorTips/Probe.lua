-- Warrior Tips: /wtips probe
--
-- Checks which warrior data WoW Forever lets addons read during combat.
-- Arm it, fight anything for a few seconds, and the results print when combat
-- ends. They are also saved in WTF\Account\<name>\<realm>\<char>\SavedVariables\WarriorTips.lua.

local _, WT = ...

local armed = false
local results

-- Each check returns "readable", "secret", "missing" or "error: ...".
local function check(fn, ...)
  if type(fn) ~= "function" then return "missing" end
  local ok, a = pcall(fn, ...)
  if not ok then return "error: " .. tostring(a):sub(1, 60) end
  if WT.IsSecret(a) then return "secret" end
  if type(a) == "table" then
    for _, v in pairs(a) do if WT.IsSecret(v) then return "secret (fields)" end end
  end
  return a == nil and "readable (nil)" or "readable"
end

local function sample()
  local s = {}
  local id = WT.spells
  s["Rage (UnitPower)"] = check(UnitPower, "player", Enum.PowerType.Rage)
  s["Player health (UnitHealth)"] = check(UnitHealth, "player")
  s["Target health (UnitHealth)"] = UnitExists("target") and check(UnitHealth, "target") or "no target"
  s["Target classification"] = UnitExists("target") and check(UnitClassification, "target") or "no target"
  s["Execute usable (IsSpellUsable)"] = id["Execute"] and check(C_Spell.IsSpellUsable, id["Execute"]) or "spell not known"
  s["Death Wish cooldown"] = id["Death Wish"] and check(C_Spell.GetSpellCooldown, id["Death Wish"]) or "spell not known"
  s["Bloodthirst cooldown"] = id["Bloodthirst"] and check(C_Spell.GetSpellCooldown, id["Bloodthirst"]) or "spell not known"
  s["Battle Shout aura"] = id["Battle Shout"] and check(C_UnitAuras.GetPlayerAuraBySpellID, id["Battle Shout"]) or "spell not known"
  s["Damage meter (current)"] = C_DamageMeter and check(C_DamageMeter.GetCombatSessionSourceFromType,
    Enum.DamageMeterSessionType.Current, Enum.DamageMeterType.DamageDone, UnitGUID("player")) or "missing"
  if C_Secrets then
    s["C_Secrets.HasSecretRestrictions"] = tostring(WT.Read(C_Secrets.HasSecretRestrictions))
    s["C_Secrets.ShouldAurasBeSecret"] = tostring(WT.Read(C_Secrets.ShouldAurasBeSecret))
    s["C_Secrets.ShouldCooldownsBeSecret"] = tostring(WT.Read(C_Secrets.ShouldCooldownsBeSecret))
    s["C_Secrets.GetPowerTypeSecrecy(Rage)"] = tostring(WT.Read(C_Secrets.GetPowerTypeSecrecy, Enum.PowerType.Rage))
  end
  if C_CombatLog and C_CombatLog.IsCombatLogRestricted then
    s["Combat log restricted"] = tostring(WT.Read(C_CombatLog.IsCombatLogRestricted))
  end
  return s
end

local function printSample(title, s)
  WT.Print(title)
  local keys = {}
  for k in pairs(s) do table.insert(keys, k) end
  table.sort(keys)
  for _, k in ipairs(keys) do
    local v = s[k]
    local color = v:find("^readable") and "|cff00ff00" or v:find("^secret") and "|cffff6060" or "|cffaaaaaa"
    WT.Print(("  %s: %s%s|r"):format(k, color, v))
  end
end

function WT.ArmProbe()
  armed = true
  results = { build = select(4, GetBuildInfo()), version = WT.version, outOfCombat = sample() }
  WT.Print(("probe armed (interface %s). Attack something for at least 5 seconds; results print when combat ends.")
    :format(tostring(results.build)))
  if UnitAffectingCombat("player") then WT.Print("you are in combat now; the in-combat check runs in 3 seconds") end
end

local function inCombatSample()
  if not armed or not results then return end
  results.inCombat = sample()
end

WT.On("PLAYER_REGEN_DISABLED", function()
  if armed then C_Timer.After(3, inCombatSample) end
end)

WT.On("UNIT_SPELLCAST_SUCCEEDED", function(_, unit, _, spellID)
  if armed and results and unit == "player" and UnitAffectingCombat("player") then
    results.castEventSpellId = WT.IsSecret(spellID) and "secret" or "readable"
  end
end)

function WT.OnProbeFightEnd()
  if not armed or not results then return end
  armed = false
  C_Timer.After(1.5, function()
    results.afterCombatMeter = C_DamageMeter and check(C_DamageMeter.GetCombatSessionSourceFromType,
      Enum.DamageMeterSessionType.Current, Enum.DamageMeterType.DamageDone, UnitGUID("player")) or "missing"
    if not results.inCombat then
      WT.Print("probe: combat was too short for the in-combat check. Run /wtips probe and try again.")
      return
    end
    printSample("probe results, in combat:", results.inCombat)
    WT.Print("  Own cast events (spell id): " .. (results.castEventSpellId or "no casts seen"))
    WT.Print("  Damage meter after combat: " .. results.afterCombatMeter)
    WT.db.lastProbe = results
    WT.Print("saved. Screenshot this or send the SavedVariables file so the tips can be tuned.")
  end)
end
