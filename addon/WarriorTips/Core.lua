-- Warrior Tips: core (saved settings, safe reads, tip display, slash commands).
--
-- WoW Forever uses retail Midnight's addon restrictions: addons cannot read the
-- combat log, and in combat many values (rage, auras, cooldowns, health) can be
-- "secret". Secret values can be shown but not compared; comparing one raises a
-- Lua error. Every read in this addon goes through WT.Read, which returns nil for
-- a secret or failed value, so a tip whose data is hidden just stays quiet.

local ADDON, WT = ...
_G.WarriorTips = WT

WT.version = "0.4.0"

local DEFAULTS = {
  enabled = true,
  sound = false,
  report = "boss",       -- "boss", "all" or "off": when to print the report card
  minGap = 4,            -- seconds between any two tips
  rageCap = 80,          -- rage at or above this counts as capping
  tips = {
    execute = true,      -- Execute became usable
    cooldowns = true,    -- big cooldown ready when a boss pull starts
    rage = true,         -- rage capping (a display-only indicator when rage is secret)
    shout = true,        -- Battle Shout missing or about to drop
    reactive = false,    -- Overpower / Revenge usable
  },
  point = nil,           -- saved position of the tip text
  fontSize = 18,         -- tip text size; the rage line is a bit smaller
  color = { 1, 0.82, 0.3 },      -- tip text color
  rageColor = { 1, 0.82, 0.3 },  -- rage capped line color
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

-- Cooldowns the tips and report card track, in the order the report lists them.
WT.BIG_COOLDOWNS = { "Death Wish", "Recklessness", "Blood Fury", "Bloodrage" }

-- Cooldowns are secret in combat on Forever, but our own cast events are not.
-- So we remember when each tracked spell is ready: from a clean cooldown read
-- (out of combat) or from our own cast plus the spell's cooldown length.
-- Lengths start at the base values and are learned from clean reads (talents).
WT.CD_BASE = { ["Death Wish"] = 180, Recklessness = 1800, ["Blood Fury"] = 120, Bloodrage = 60,
  Bloodthirst = 6, ["Mortal Strike"] = 6, Whirlwind = 10 }
WT.readyAt = {}

function WT.CooldownLength(name)
  local learned = WT.db and WT.db.cdLength and WT.db.cdLength[name]
  return learned or WT.CD_BASE[name]
end

-- Update the tracker from a clean read, if the cooldown is readable right now.
function WT.SyncCooldown(name)
  local id = WT.spells[name]
  if not id then return end
  local cd = WT.Read(C_Spell.GetSpellCooldown, id)
  if type(cd) ~= "table" then return end
  local start, dur = cd.startTime, cd.duration
  if isSecret(start) or isSecret(dur) or not start or not dur then return end
  if start == 0 or dur <= 1.5 then
    WT.readyAt[name] = 0
  else
    WT.readyAt[name] = start + dur
    -- A fresh cooldown shows its full length: remember it (talents change it).
    if WT.db and GetTime() - start < 2 and WT.CD_BASE[name] then
      WT.db.cdLength = WT.db.cdLength or {}
      WT.db.cdLength[name] = dur
    end
  end
end

-- We cast it just now: it's ready again after its cooldown length.
function WT.NoteCast(name)
  local len = WT.CooldownLength(name)
  if len then WT.readyAt[name] = GetTime() + len end
end

-- Seconds until ready: live read when possible, else the tracker. nil if unknown.
function WT.CooldownLeftTracked(name)
  if not WT.Knows(name) then return nil end
  local live = WT.CooldownLeft(name)
  if live ~= nil then return live end
  local at = WT.readyAt[name]
  if at == nil then return nil end
  return math.max(0, at - GetTime())
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
    -- nil can mean "missing" or "hidden" (Forever returns nil for a hidden aura
    -- in combat); only trust it when auras are not secret right now.
    if C_Secrets then
      local all = WT.Read(C_Secrets.ShouldAurasBeSecret)
      local one = WT.Read(C_Secrets.ShouldSpellAuraBeSecret, id)
      if all ~= false and all ~= nil then return nil end
      if one ~= false and one ~= nil then return nil end
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
local FONT = (GameFontNormalLarge and GameFontNormalLarge.GetFont and GameFontNormalLarge:GetFont()) or "Fonts\\FRIZQT__.TTF"

-- Apply font size and colors from settings to the tip text and the rage line.
function WT.ApplyStyle()
  local db = WT.db
  local size = db.fontSize
  pcall(text.SetFont, text, FONT, size, "OUTLINE")
  text:SetTextColor(db.color[1], db.color[2], db.color[3])
  frame:SetSize(math.max(420, size * 30), size * 2 + 4)
  if WT.StyleRage then WT.StyleRage(FONT, math.floor(size * 0.8 + 0.5), db.rageColor) end
end

-- Named colors for /wtips color, or a hex code like ff8800.
local COLORS = { gold = { 1, 0.82, 0.3 }, white = { 1, 1, 1 }, red = { 1, 0.25, 0.25 }, orange = { 1, 0.55, 0.1 },
  yellow = { 1, 1, 0.2 }, green = { 0.3, 1, 0.3 }, cyan = { 0.3, 0.9, 1 }, blue = { 0.4, 0.6, 1 },
  purple = { 0.75, 0.45, 1 }, pink = { 1, 0.5, 0.8 } }
local function parseColor(v)
  if not v then return nil end
  if COLORS[v] then return { unpack(COLORS[v]) } end
  local hex = v:gsub("^#", "")
  if hex:match("^%x%x%x%x%x%x$") then
    return { tonumber(hex:sub(1, 2), 16) / 255, tonumber(hex:sub(3, 4), 16) / 255, tonumber(hex:sub(5, 6), 16) / 255 }
  end
end

-- Open the game's color picker for a setting ("color" or "rageColor").
-- done() runs after every change or cancel (the options window repaints its swatch).
local function pickColor(key, done)
  local c = WT.db[key]
  local function apply()
    local r, g, b = ColorPickerFrame:GetColorRGB()
    WT.db[key] = { r, g, b }; WT.ApplyStyle(); WT.ShowSample()
    if done then done() end
  end
  local info = { r = c[1], g = c[2], b = c[3], hasOpacity = false, swatchFunc = apply,
    cancelFunc = function() WT.db[key] = c; WT.ApplyStyle(); if done then done() end end }
  if ColorPickerFrame and ColorPickerFrame.SetupColorPickerAndShow then
    ColorPickerFrame:SetupColorPickerAndShow(info)
    return true
  end
end
WT.PickColor = pickColor

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

-- Show a message on the tip frame.
function WT.Show(msg)
  text:SetText(msg)
  frame:SetAlpha(1)
  frame:Show()
  shownAt = GetTime()
  if WT.db.sound then PlaySound(SOUNDKIT.RAID_WARNING) end
end

-- Show a tip. key is the setting that turns it on; repeats of the same tip
-- (same id, default key) are throttled for `again` seconds (default 20).
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

-- Preview after a style change: a sample tip, plus the rage line for a few seconds.
function WT.ShowSample()
  WT.Show("Execute phase: Execute is your main button now")
  if WT.PreviewRage then WT.PreviewRage(4) end
end

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
    text:SetText("Warrior Tips: drag me, then Lock")
    frame:SetAlpha(1); bg:Show(); frame:Show()
  else
    bg:Hide(); frame:Hide()
  end
end
WT.SetUnlocked = setUnlocked
function WT.IsUnlocked() return frame.unlocked == true end

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
  WT.ApplyStyle()
  WT.debug = WT.db.debug or false
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
  local function hex(c) return ("%02x%02x%02x"):format(c[1] * 255 + 0.5, c[2] * 255 + 0.5, c[3] * 255 + 0.5) end
  WT.Print(("  text size %d, tip color %s, rage line color %s"):format(db.fontSize, hex(db.color), hex(db.rageColor)))
  for _, k in ipairs(TIP_NAMES) do
    WT.Print(("  %s: %s"):format(k, db.tips[k] and "on" or "off"))
  end
end

local function help()
  WT.Print("/wtips opens the options window. Commands:")
  WT.Print("  /wtips on | off  - turn all live tips on or off")
  WT.Print("  /wtips tip <name> on|off  - " .. table.concat(TIP_NAMES, ", "))
  WT.Print("  /wtips report boss|all|off  - when to print the report card after a fight")
  WT.Print("  /wtips ragecap <n>  - rage that counts as capping (default 80)")
  WT.Print("  /wtips size <10-40>  - tip text size (default 18)")
  WT.Print("  /wtips color [name or hex]  - tip color; no value opens a color picker")
  WT.Print("  /wtips ragecolor [name or hex]  - rage capped line color")
  WT.Print("    colors: gold, white, red, orange, yellow, green, cyan, blue, purple, pink, or e.g. ff8800")
  WT.Print("  /wtips sound on|off, /wtips unlock | lock, /wtips test")
  WT.Print("  /wtips probe  - check what Forever lets addons read in your next fight")
  WT.Print("  /wtips debug on|off  - full report card after every fight, for testing")
  WT.Print("  /wtips status, /wtips help")
end

SLASH_WARRIORTIPS1 = "/wtips"
SLASH_WARRIORTIPS2 = "/warriortips"
SlashCmdList.WARRIORTIPS = function(input)
  local cmd, a, b = strsplit(" ", strlower(strtrim(input or "")))
  local db = WT.db
  if cmd == "" or cmd == nil or cmd == "options" or cmd == "config" then
    if WT.ToggleOptions then WT.ToggleOptions() else help() end
    return
  end
  if cmd == "on" or cmd == "off" then
    db.enabled = cmd == "on"; status()
  elseif cmd == "tip" and db.tips[a or ""] ~= nil and (b == "on" or b == "off") then
    db.tips[a] = b == "on"; WT.Print(a .. " tips " .. b)
  elseif cmd == "report" and (a == "boss" or a == "all" or a == "off") then
    db.report = a; WT.Print("report card: " .. a)
  elseif cmd == "ragecap" and tonumber(a) then
    db.rageCap = math.max(30, math.min(100, tonumber(a))); WT.Print("rage cap " .. db.rageCap)
  elseif cmd == "size" and tonumber(a) then
    db.fontSize = math.max(10, math.min(40, math.floor(tonumber(a)))); WT.ApplyStyle()
    WT.Print("text size " .. db.fontSize); WT.ShowSample()
  elseif cmd == "color" or cmd == "ragecolor" then
    local key = cmd == "color" and "color" or "rageColor"
    local c = parseColor(a)
    if c then db[key] = c; WT.ApplyStyle(); WT.ShowSample()
    elseif a or not pickColor(key) then WT.Print("unknown color. Use a name (gold, white, red, orange, yellow, green, cyan, blue, purple, pink) or a hex code like ff8800") end
  elseif cmd == "sound" and (a == "on" or a == "off") then
    db.sound = a == "on"; WT.Print("sound " .. a)
  elseif cmd == "unlock" then setUnlocked(true)
  elseif cmd == "lock" then setUnlocked(false)
  elseif cmd == "test" then
    WT.ShowSample()
  elseif cmd == "probe" then WT.ArmProbe()
  elseif cmd == "debug" then
    if a == "on" or a == "off" then WT.debug = a == "on" else WT.debug = not WT.debug end
    db.debug = WT.debug
    WT.Print("debug mode " .. (WT.debug and "on: full report card after every fight, plus errors" or "off"))
  elseif cmd == "status" then status()
  else help() end
  if WT.RefreshOptions then WT.RefreshOptions() end
end
