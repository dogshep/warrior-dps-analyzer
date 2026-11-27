-- Warrior Tips: core (saved settings, safe reads, tip display, slash commands).
--
-- WoW Forever uses retail Midnight's addon restrictions: addons cannot read the
-- combat log, and in combat many values (rage, auras, cooldowns, health) can be
-- "secret". Secret values can be shown but not compared; comparing one raises a
-- Lua error. Every read in this addon goes through WT.Read, which returns nil for
-- a secret or failed value, so a tip whose data is hidden just stays quiet.

local ADDON, WT = ...
_G.WarriorTips = WT

WT.version = "0.1.0"

local DEFAULTS = {
  enabled = true,
  sound = false,
  report = "boss",       -- "boss", "all" or "off": when to print the report card
  minGap = 4,            -- seconds between any two tips
  rageCap = 80,          -- rage at or above this counts as capping
  tips = {
    execute = true,      -- Execute became usable
    cooldowns = true,    -- big cooldown ready when a boss pull starts
    rage = true,         -- rage capping (only if rage is readable in combat)
    shout = true,        -- Battle Shout missing or about to drop
    reactive = false,    -- Overpower / Revenge usable
  },
  point = nil,           -- saved position of the tip text
}

local function copyDefaults(dst, src)
  for k, v in pairs(src) do
    if type(v) == "table" then
      if type(dst[k]) ~= "table" then dst[k] = {} end
      copyDefaults(dst[k], v)
    elseif dst[k] == nil then
      dst[k] = v
    end
  end
end

-- issecretvalue only exists on clients with secret restrictions.
local isSecret = _G.issecretvalue or function() return false end
WT.IsSecret = isSecret

-- Call fn(...) and return its results, or nil if it errors or the first result is secret.
function WT.Read(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d = pcall(fn, ...)
  if not ok or isSecret(a) then return nil end
  return a, b, c, d
end

-- Read one field of a table returned by fn(...), nil if the table or field is secret.
function WT.ReadField(field, fn, ...)
  local t = WT.Read(fn, ...)
  if type(t) ~= "table" then return nil end
  local ok, v = pcall(function() return t[field] end)
  if not ok or isSecret(v) then return nil end
  return v
end

function WT.Print(msg)
  DEFAULT_CHAT_FRAME:AddMessage("|cffc79c6eWarrior Tips|r: " .. msg)
end

-- Spell lookup by English name. Forever uses its own spell ids, so ids are
-- resolved from the player's spellbook at login instead of being hard-coded.
WT.spells = {}
local SPELLS = { "Execute", "Death Wish", "Recklessness", "Bloodrage", "Blood Fury",
  "Battle Shout", "Heroic Strike", "Cleave", "Overpower", "Revenge", "Bloodthirst",
  "Mortal Strike", "Whirlwind" }

function WT.RefreshSpells()
  wipe(WT.spells)
  for _, name in ipairs(SPELLS) do
    local info = WT.Read(C_Spell.GetSpellInfo, name)
    if info and info.spellID then WT.spells[name] = info.spellID end
  end
end

function WT.Knows(name) return WT.spells[name] ~= nil end

-- Seconds left on a spell's cooldown (0 when ready or only the global cooldown), nil if hidden.
function WT.CooldownLeft(name)
  local id = WT.spells[name]
  if not id then return nil end
  local cd = WT.Read(C_Spell.GetSpellCooldown, id)
  if type(cd) ~= "table" then return nil end
  local start, dur = cd.startTime, cd.duration
  if isSecret(start) or isSecret(dur) or not start or not dur then return nil end
  if start == 0 or dur <= 1.5 then return 0 end
  return math.max(0, start + dur - GetTime())
end

-- When the spell's current cooldown started (GetTime clock), 0 if ready, nil if hidden.
function WT.CooldownStart(name)
  local id = WT.spells[name]
  if not id then return nil end
  local start = WT.ReadField("startTime", C_Spell.GetSpellCooldown, id)
  local dur = WT.ReadField("duration", C_Spell.GetSpellCooldown, id)
  if not start or not dur then return nil end
  if dur <= 1.5 then return 0 end
  return start
end

-- Is the spell usable now? Lacking rage still counts (Execute phase with 5 rage is still Execute phase).
function WT.UsableIgnoringRage(name)
  local id = WT.spells[name]
  if not id then return nil end
  local usable, noPower = WT.Read(C_Spell.IsSpellUsable, id)
  if usable == nil then return nil end
  if isSecret(noPower) then noPower = false end
  return usable or noPower or false
end

function WT.Rage()
  return WT.Read(UnitPower, "player", Enum.PowerType.Rage)
end

-- Battle Shout seconds left (0 if missing), nil if auras are hidden right now.
function WT.ShoutLeft()
  local id = WT.spells["Battle Shout"]
  if not id then return nil end
  local ok, aura = pcall(C_UnitAuras.GetPlayerAuraBySpellID, id)
  if not ok or isSecret(aura) then return nil end
  if aura == nil then
    -- nil can mean "missing" or "hidden"; only trust it when auras are not secret.
    if C_Secrets and C_Secrets.ShouldSpellAuraBeSecret then
      local okS, secret = pcall(C_Secrets.ShouldSpellAuraBeSecret, id)
      if not okS or secret then return nil end
    end
    return 0
  end
  local exp = aura.expirationTime
  if isSecret(exp) or not exp then return nil end
  if exp == 0 then return 3600 end
  return math.max(0, exp - GetTime())
end

-- Is the current target a boss (skull level or worldboss)?
function WT.TargetIsBoss()
  if not UnitExists("target") then return false end
  local lvl = WT.Read(UnitLevel, "target")
  local cls = WT.Read(UnitClassification, "target")
  return lvl == -1 or cls == "worldboss"
end

---------------------------------------------------------------------------
-- Tip display: one line of text above the character, fades out, throttled.
---------------------------------------------------------------------------
local frame = CreateFrame("Frame", "WarriorTipsFrame", UIParent)
frame:SetSize(420, 40)
frame:SetFrameStrata("HIGH")
frame:Hide()
local text = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
text:SetPoint("CENTER")
text:SetTextColor(1, 0.82, 0.3)
frame.text = text

local bg = frame:CreateTexture(nil, "BACKGROUND")
bg:SetAllPoints()
bg:SetColorTexture(0, 0, 0, 0.5)
bg:Hide()

local shownAt, holdFor = 0, 3
frame:SetScript("OnUpdate", function(self)
  if self.unlocked then return end
  local age = GetTime() - shownAt
  if age > holdFor + 1 then self:Hide()
  elseif age > holdFor then self:SetAlpha(holdFor + 1 - age) end
end)

local lastTip, lastByKey = 0, {}

-- Show a tip. key is the setting that turns it on; repeats of the same tip
-- (same id, default key) are throttled for `again` seconds (default 20).
function WT.Show(msg)
  text:SetText(msg)
  frame:SetAlpha(1)
  frame:Show()
  shownAt = GetTime()
  if WT.db.sound then PlaySound(SOUNDKIT.RAID_WARNING) end
end

function WT.Tip(key, msg, again, id)
  local db = WT.db
  if not db or not db.enabled or not WT.isWarrior or not db.tips[key] then return end
  local now = GetTime()
  if now - lastTip < db.minGap then return end
  id = id or key
  if lastByKey[id] and now - lastByKey[id] < (again or 20) then return end
  lastTip, lastByKey[id] = now, now
  WT.Show(msg)
  if WT.fight then table.insert(WT.fight.tips, key) end
end

function WT.ResetThrottle() wipe(lastByKey) end

local function placeFrame()
  frame:ClearAllPoints()
  local p = WT.db.point
  if p then frame:SetPoint(p[1], UIParent, p[2], p[3], p[4])
  else frame:SetPoint("CENTER", UIParent, "CENTER", 0, 180) end
end

local function setUnlocked(on)
  frame.unlocked = on
  frame:SetMovable(on)
  frame:EnableMouse(on)
  if on then
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", function(self)
      self:StopMovingOrSizing()
      local a, _, b, x, y = self:GetPoint()
      WT.db.point = { a, b, x, y }
    end)
    text:SetText("Warrior Tips: drag me, then /wtips lock")
    frame:SetAlpha(1); bg:Show(); frame:Show()
  else
    bg:Hide(); frame:Hide()
  end
end

---------------------------------------------------------------------------
-- Events: modules register handlers with WT.On(event, fn).
---------------------------------------------------------------------------
local handlers = {}
local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(_, event, ...)
  for _, fn in ipairs(handlers[event]) do
    local ok, err = pcall(fn, event, ...)
    if not ok and WT.debug then WT.Print("error in " .. event .. ": " .. tostring(err)) end
  end
end)

function WT.On(event, fn)
  if not handlers[event] then
    handlers[event] = {}
    -- Some events don't exist on every client; ignore those. Unit events only matter for the player, so they are
    -- registered for "player" alone (otherwise every raid member's and nameplate's casts fire them in combat).
    local ok = event:sub(1, 5) == "UNIT_" and events.RegisterUnitEvent and pcall(events.RegisterUnitEvent, events, event, "player")
    if not ok then pcall(events.RegisterEvent, events, event) end
  end
  table.insert(handlers[event], fn)
end

WT.On("PLAYER_LOGIN", function()
  WarriorTipsDB = WarriorTipsDB or {}
  copyDefaults(WarriorTipsDB, DEFAULTS)
  WT.db = WarriorTipsDB
  placeFrame()
  WT.RefreshSpells()
  local _, class = UnitClass("player")
  WT.isWarrior = class == "WARRIOR"
end)
WT.On("SPELLS_CHANGED", function() WT.RefreshSpells() end)

---------------------------------------------------------------------------
-- Slash commands
---------------------------------------------------------------------------
local TIP_NAMES = { "execute", "cooldowns", "rage", "shout", "reactive" }

local function status()
  local db = WT.db
  WT.Print(("v%s, tips %s, report card: %s, rage cap %d"):format(WT.version,
    db.enabled and "|cff00ff00on|r" or "|cffff0000off|r", db.report, db.rageCap))
  for _, k in ipairs(TIP_NAMES) do
    WT.Print(("  %s: %s"):format(k, db.tips[k] and "on" or "off"))
  end
end

local function help()
  WT.Print("commands:")
  WT.Print("  /wtips on | off  - turn all live tips on or off")
  WT.Print("  /wtips tip <name> on|off  - " .. table.concat(TIP_NAMES, ", "))
  WT.Print("  /wtips report boss|all|off  - when to print the report card after a fight")
  WT.Print("  /wtips ragecap <n>  - rage that counts as capping (default 80)")
  WT.Print("  /wtips sound on|off, /wtips unlock | lock, /wtips test")
  WT.Print("  /wtips probe  - check what Forever lets addons read in your next fight")
  WT.Print("  /wtips status")
end

SLASH_WARRIORTIPS1 = "/wtips"
SLASH_WARRIORTIPS2 = "/warriortips"
SlashCmdList.WARRIORTIPS = function(input)
  local cmd, a, b = strsplit(" ", strlower(strtrim(input or "")))
  local db = WT.db
  if cmd == "on" or cmd == "off" then
    db.enabled = cmd == "on"; status()
  elseif cmd == "tip" and db.tips[a or ""] ~= nil and (b == "on" or b == "off") then
    db.tips[a] = b == "on"; WT.Print(a .. " tips " .. b)
  elseif cmd == "report" and (a == "boss" or a == "all" or a == "off") then
    db.report = a; WT.Print("report card: " .. a)
  elseif cmd == "ragecap" and tonumber(a) then
    db.rageCap = math.max(30, math.min(100, tonumber(a))); WT.Print("rage cap " .. db.rageCap)
  elseif cmd == "sound" and (a == "on" or a == "off") then
    db.sound = a == "on"; WT.Print("sound " .. a)
  elseif cmd == "unlock" then setUnlocked(true)
  elseif cmd == "lock" then setUnlocked(false)
  elseif cmd == "test" then
    WT.Show("Execute phase: Execute is your main button now")
  elseif cmd == "probe" then WT.ArmProbe()
  elseif cmd == "debug" then WT.debug = not WT.debug; WT.Print("debug " .. tostring(WT.debug))
  elseif cmd == "status" then status()
  else help() end
end
