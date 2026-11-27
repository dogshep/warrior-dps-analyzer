-- Offline smoke test for addon/WarriorTips with a mocked WoW Forever API.
-- Run: lua5.1 tests/addon/run.lua [secret]
-- "secret" mirrors what /wtips probe found on Forever: in combat rage, health and
-- cooldowns are secret, auras come back nil, own cast spell ids stay readable.
local SECRET_MODE = arg[1] == "secret"
local SECRET = setmetatable({}, { __lt = function() error("compared a secret") end, __le = function() error("compared a secret") end,
  __eq = function() error("compared a secret") end, __index = function() error("indexed a secret") end })
local now, inCombat, timers, printed, shown = 1000, false, {}, {}, {}
local state = { rage = 20, targetHp = 1, cdStart = {}, shoutExp = 1000 + 100 }
local CD = { [102] = 180, [103] = 1800, [105] = 6, [106] = 10 }
local indicatorShown = 0
local function hide(v) if SECRET_MODE and inCombat then return SECRET end return v end

_G.issecretvalue = function(v) return v == SECRET end
GetTime = function() return now end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strsplit = function(sep, s) local out = {} for w in s:gmatch("[^" .. sep .. "]+") do out[#out + 1] = w end return unpack(out) end
strlower, strtrim = string.lower, function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Enum = { PowerType = { Rage = 1 }, AddOnRestrictionState = { Activating = 1 }, LuaCurveType = { Step = 1 },
  DamageMeterSessionType = { Current = 1 }, DamageMeterType = { DamageDone = 0 } }
SOUNDKIT = { RAID_WARNING = 1 }; PlaySound = function() end
DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) printed[#printed + 1] = m:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "") end }
SlashCmdList = {}
local IDS = { Execute = 101, ["Death Wish"] = 102, Recklessness = 103, ["Battle Shout"] = 104, Bloodthirst = 105, Whirlwind = 106, ["Heroic Strike"] = 107 }
local NAMES = {}; for k, v in pairs(IDS) do NAMES[v] = k end; NAMES[6603] = "Auto Attack"
C_Spell = {
  GetSpellInfo = function(n) return IDS[n] and { spellID = IDS[n], name = n } end,
  GetSpellName = function(id) return NAMES[id] end,
  GetSpellCooldown = function(id)
    local start = state.cdStart[id] or 0
    if start > 0 and now >= start + CD[id] then start = 0 end
    return { startTime = hide(start), duration = hide(start > 0 and CD[id] or 0) }
  end,
  IsSpellUsable = function(id) if id == 101 then return state.targetHp < 0.2, false end return true, false end,
}
C_UnitAuras = { GetPlayerAuraBySpellID = function(id)
  if SECRET_MODE and inCombat then return nil end   -- Forever returns nil for a hidden aura
  if id == 104 and state.shoutExp > now then return { expirationTime = state.shoutExp, duration = 120 } end
end }
C_Secrets = { ShouldSpellAuraBeSecret = function() return SECRET_MODE and inCombat end, HasSecretRestrictions = function() return true end,
  ShouldAurasBeSecret = function() return SECRET_MODE and inCombat end }
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
C_CurveUtil = { CreateColorCurve = function()
  local c = { points = {} }
  function c:SetType() end
  function c:AddPoint(x, col) self.points[#self.points + 1] = { x = x, col = col } end
  return c
end }
UnitPowerPercent = function(_, _, _, curve)
  local pct, col = state.rage / 100, nil
  for _, p in ipairs(curve.points) do if pct >= p.x then col = p.col end end
  if SECRET_MODE and inCombat then
    return { GetRGBA = function() return SECRET, SECRET, SECRET, col.a == 1 and SECRET or SECRET end, _alpha = col.a }
  end
  return { GetRGBA = function() return col.r, col.g, col.b, col.a end }
end
C_DamageMeter = { IsDamageMeterAvailable = function() return true, "" end,
  GetCombatSessionSourceFromType = function()
    if inCombat then return SECRET end
    return { totalAmount = 60000, combatSpells = { { spellID = 105, totalAmount = 20000 }, { spellID = 6603, totalAmount = 25000 },
      { spellID = 106, totalAmount = 9000 }, { spellID = 101, totalAmount = 6000 } } }
  end }
C_Timer = {
  After = function(d, fn) timers[#timers + 1] = { at = now + d, fn = fn } end,
  NewTicker = function(d, fn) local t = { at = now + d, fn = fn, every = d }; timers[#timers + 1] = t; t.Cancel = function() t.dead = true end; return t end,
}
UnitPower = function() return hide(state.rage) end
UnitHealth = function(u) return SECRET end
UnitExists = function() return true end
UnitCanAttack = function() return true end
UnitLevel = function() return -1 end
UnitClassification = function() return "worldboss" end
UnitClass = function() return "Warrior", "WARRIOR" end
UnitGUID = function() return "Player-1" end
UnitAffectingCombat = function() return inCombat end
GetBuildInfo = function() return "1.60.1", "70938", "", 16001 end

local frames = {}
local function newObj()
  local o = {}
  return setmetatable(o, { __index = function(t, k) return function(self, ...)
    if k == "SetText" then self._text = ...; elseif k == "Show" and self._text then shown[#shown + 1] = { t = now, text = self._text } end
    if k == "CreateFontString" or k == "CreateTexture" then local c = newObj(); self._child = c; return c end
  end end })
end
CreateFrame = function()
  local f = newObj()
  f.RegisterEvent = function(self, e) local ev = rawget(self, "events") or {}; rawset(self, "events", ev); ev[e] = true end
  f.RegisterUnitEvent = f.RegisterEvent
  f.SetScript = function(self, s, fn) self[s] = fn end
  -- Tip text lives in the font string, record it when the frame shows.
  f.CreateFontString = function(self) local fs = newObj(); fs.SetText = function(s, t) rawset(self, "_text", t) end
    -- Secret colors may be passed to SetTextColor; count them (the rage indicator).
    fs.SetTextColor = function(_, r) if r == SECRET then indicatorShown = indicatorShown + 1 end end
    return fs end
  f.Show = function(self) if rawget(self, "_text") then shown[#shown + 1] = { t = now, text = self._text } end end
  frames[#frames + 1] = f
  return f
end
UIParent = newObj()

local ns = {}
for _, file in ipairs({ "Core.lua", "Probe.lua", "Tips.lua", "Report.lua" }) do
  assert(loadfile("addon/WarriorTips/" .. file))("WarriorTips", ns)
end
local function fire(e, ...) for _, f in ipairs(frames) do local ev, h = rawget(f, "events"), rawget(f, "OnEvent"); if ev and ev[e] and h then h(f, e, ...) end end end
local function advance(sec)
  local stop = now + sec
  while true do
    table.sort(timers, function(a, b) return a.at < b.at end)
    local t = timers[1]
    if not t or t.at > stop then break end
    table.remove(timers, 1)
    now = t.at
    if not t.dead then t.fn(); if t.every then t.at = now + t.every; timers[#timers + 1] = t end end
  end
  now = stop
end

local function cast(name)
  local id = IDS[name]
  if CD[id] then state.cdStart[id] = now end
  if name == "Battle Shout" then state.shoutExp = now + 120 end
  fire("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-" .. now, id)
end
-- Fight for `sec` seconds pressing Bloodthirst every 10s (too slow on purpose).
local function fight(sec)
  local stop = now + sec
  while now < stop do
    if (state.cdStart[105] or 0) + 10 <= now then cast("Bloodthirst") end
    if state.targetHp < 0.2 and math.floor(now) % 3 == 0 then cast("Execute") end
    advance(1)
  end
end

fire("PLAYER_LOGIN")
fire("PLAYER_ENTERING_WORLD")
advance(3)
ns.debug = true
SlashCmdList.WARRIORTIPS("probe")
-- Pull: restriction activates, combat starts, encounter starts.
fire("ADDON_RESTRICTION_STATE_CHANGED", 0, 1)
inCombat = true
fire("PLAYER_REGEN_DISABLED")
fire("ENCOUNTER_START")
local pull = now
fight(2); cast("Death Wish")                             -- Death Wish on pull
fight(3)
state.rage = 95; fight(5); state.rage = 30              -- rage cap (indicator in secret mode)
fight(85)                                               -- shout expires 100s after login
fight(10); cast("Battle Shout")                         -- recast late
fight(85)                                               -- Death Wish back ~180s after the pull
state.targetHp = 0.15; fight(15)                        -- execute phase
inCombat = false
fire("PLAYER_REGEN_ENABLED")
advance(3)

print("== tips shown (" .. (SECRET_MODE and "secret" or "readable") .. " mode)")
for _, s in ipairs(shown) do print(("  +%3ds  %s"):format(s.t - pull, s.text)) end
print("== rage indicator colored from a secret value " .. indicatorShown .. " times")
print("== chat")
for _, m in ipairs(printed) do print("  " .. m) end
local errors = 0
for _, m in ipairs(printed) do if m:find("error") and not m:find("^Warrior Tips:   ") then errors = errors + 1 end end
if errors > 0 then print("FAILED: " .. errors .. " errors"); os.exit(1) end
