-- Warrior Tips: options window.
--
-- /wtips opens it; it is also linked from Esc > Options > AddOns. Every
-- control writes the same saved settings the slash commands use, and the
-- window repaints itself when a slash command changes something.

local _, WT = ...

local win              -- the window, built on first open
local controls = {}    -- refresh functions, one per control

local W, PAD = 440, 16

local function label(parent, text, font, x, y)
  local fs = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlight")
  fs:SetPoint("TOPLEFT", x, y)
  fs:SetJustifyH("LEFT")
  fs:SetText(text)
  return fs
end

local function header(parent, text, y)
  label(parent, text, "GameFontNormalLarge", PAD, y)
  local line = parent:CreateTexture(nil, "ARTWORK")
  line:SetColorTexture(1, 0.82, 0, 0.25)
  line:SetPoint("TOPLEFT", PAD, y - 22)
  line:SetSize(W - 2 * PAD, 1)
  return y - 30
end

-- Checkbox bound to get()/set(v). Returns the next y.
local function checkbox(parent, text, hint, x, y, get, set)
  local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
  cb:SetPoint("TOPLEFT", x, y + 4)
  cb:SetSize(26, 26)
  local fs = label(parent, text, "GameFontHighlight", x + 30, y)
  if hint then
    local h = label(parent, hint, "GameFontDisableSmall", x + 30, y - 15)
    h:SetWidth(W - x - 46)
  end
  cb:SetScript("OnClick", function(self) set(self:GetChecked() and true or false); WT.RefreshOptions() end)
  table.insert(controls, function() cb:SetChecked(get()) end)
  -- Clicking the label toggles too.
  local hit = CreateFrame("Button", nil, parent)
  hit:SetPoint("TOPLEFT", fs, "TOPLEFT")
  hit:SetSize((fs:GetStringWidth() or 100) + 4, 16)
  hit:SetScript("OnClick", function() cb:Click() end)
  return y - (hint and 36 or 26)
end

-- Number control: a Blizzard slider where available, else - / + buttons.
local function slider(parent, text, x, y, min, max, step, get, set)
  label(parent, text, "GameFontHighlight", x, y)
  if MinimalSliderWithSteppersMixin and MinimalSliderWithSteppersMixin.Label then
    local ok, s = pcall(CreateFrame, "Frame", nil, parent, "MinimalSliderWithSteppersTemplate")
    if ok and s and s.Init then
      s:SetPoint("TOPLEFT", x + 150, y + 4)
      s:SetSize(220, 20)
      local L = MinimalSliderWithSteppersMixin.Label
      s:Init(get(), min, max, (max - min) / step, { [L.Right] = function(v) return tostring(math.floor(v + 0.5)) end })
      s:RegisterCallback(MinimalSliderWithSteppersMixin.Event.OnValueChanged, function(_, v)
        v = math.floor(v + 0.5)
        if v ~= get() then set(v) end
      end, s)
      table.insert(controls, function() if math.floor(s.Slider:GetValue() + 0.5) ~= get() then s:SetValue(get()) end end)
      return y - 30
    end
  end
  local value = label(parent, "", "GameFontNormal", x + 200, y)
  local function stepBtn(txt, dx, delta)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetSize(26, 20)
    b:SetPoint("TOPLEFT", x + dx, y + 3)
    b:SetText(txt)
    b:SetScript("OnClick", function() set(math.max(min, math.min(max, get() + delta))); WT.RefreshOptions() end)
  end
  stepBtn("-", 160, -step)
  stepBtn("+", 240, step)
  table.insert(controls, function() value:SetText(tostring(get())) end)
  return y - 30
end

-- Color swatch that opens the color picker for a saved color.
local function swatch(parent, text, x, y, key)
  label(parent, text, "GameFontHighlight", x, y)
  local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
  b:SetPoint("TOPLEFT", x + 150, y + 3)
  b:SetSize(40, 18)
  if b.SetBackdrop then
    b:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8x8", edgeSize = 1 })
    b:SetBackdropBorderColor(0.6, 0.6, 0.6, 1)
  end
  local tex = b:CreateTexture(nil, "ARTWORK")
  tex:SetPoint("TOPLEFT", 1, -1)
  tex:SetPoint("BOTTOMRIGHT", -1, 1)
  b:SetScript("OnClick", function()
    if not WT.PickColor(key, WT.RefreshOptions) then WT.Print("color picker not available; use /wtips color <name>") end
  end)
  table.insert(controls, function() local c = WT.db[key]; tex:SetColorTexture(c[1], c[2], c[3], 1) end)
  return y - 28
end

local function button(parent, text, x, y, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(w, 24)
  b:SetText(text)
  b:SetScript("OnClick", onClick)
  return b
end

local TIPS = {
  { "execute", "Execute phase", "When Execute lights up on a boss or elite, with Recklessness / Death Wish if ready." },
  { "cooldowns", "Big cooldowns", "Death Wish / Blood Fury ready on a boss pull, and ready again mid fight." },
  { "rage", "Rage capped line", "A line under the tips that lights up while rage is at the cap." },
  { "shout", "Battle Shout", "About to drop, or down." },
  { "reactive", "Overpower / Revenge", "When they light up." },
}

local function build()
  local db = WT.db
  win = CreateFrame("Frame", "WarriorTipsOptions", UIParent, "BackdropTemplate")
  win:SetSize(W, 720)
  win:SetPoint("CENTER")
  win:SetFrameStrata("DIALOG")
  win:SetMovable(true)
  win:EnableMouse(true)
  win:RegisterForDrag("LeftButton")
  win:SetScript("OnDragStart", win.StartMoving)
  win:SetScript("OnDragStop", win.StopMovingOrSizing)
  win:SetClampedToScreen(true)
  if win.SetBackdrop then
    win:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8x8", edgeFile = "Interface\\Buttons\\WHITE8x8", edgeSize = 1 })
    win:SetBackdropColor(0.06, 0.06, 0.08, 0.95)
    win:SetBackdropBorderColor(0.78, 0.61, 0.43, 1)
  end
  -- Close with Escape.
  if UISpecialFrames then table.insert(UISpecialFrames, "WarriorTipsOptions") end

  local title = label(win, "Warrior Tips  |cff888888v" .. WT.version .. "|r", "GameFontNormalLarge", PAD, -14)
  title:SetTextColor(0.78, 0.61, 0.43)
  local close = CreateFrame("Button", nil, win, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", -4, -4)
  close:SetScript("OnClick", function() win:Hide() end)

  local y = -46
  y = header(win, "General", y)
  y = checkbox(win, "Show live tips", nil, PAD, y, function() return db.enabled end, function(v) db.enabled = v end)
  y = checkbox(win, "Play a sound with each tip", nil, PAD, y, function() return db.sound end, function(v) db.sound = v end)
  y = checkbox(win, "Debug mode", "Full report card after every fight, even short trash, plus Lua errors.", PAD, y,
    function() return WT.debug end, function(v) WT.debug = v; db.debug = v end)

  label(win, "Report card after:", "GameFontHighlight", PAD, y - 2)
  local modes = { { "boss", "Bosses" }, { "all", "Every fight" }, { "off", "Never" } }
  for i, m in ipairs(modes) do
    checkbox(win, m[2], nil, PAD + 120 + (i - 1) * 100, y, function() return db.report == m[1] end,
      function() db.report = m[1] end)
  end
  y = y - 34

  y = header(win, "Tips", y)
  for _, t in ipairs(TIPS) do
    local key = t[1]
    y = checkbox(win, t[2], t[3], PAD, y, function() return db.tips[key] end, function(v) db.tips[key] = v end)
  end

  y = header(win, "Look", y - 4)
  y = slider(win, "Text size", PAD, y, 10, 40, 1, function() return db.fontSize end,
    function(v) db.fontSize = v; WT.ApplyStyle(); WT.ShowSample() end)
  y = slider(win, "Rage cap", PAD, y, 30, 100, 5, function() return db.rageCap end,
    function(v) db.rageCap = v end)
  y = swatch(win, "Tip color", PAD, y, "color")
  y = swatch(win, "Rage line color", PAD, y, "rageColor")

  y = y - 8
  local move
  move = button(win, "Move tips", PAD, y, 120, function()
    WT.SetUnlocked(not WT.IsUnlocked()); WT.RefreshOptions()
  end)
  table.insert(controls, function() move:SetText(WT.IsUnlocked() and "Lock position" or "Move tips") end)
  button(win, "Test tip", PAD + 130, y, 120, function() WT.ShowSample() end)
  button(win, "Run probe", PAD + 260, y, 120, function() WT.ArmProbe() end)
  y = y - 34

  label(win, "Probe: checks what the game lets addons read in your next fight.", "GameFontDisableSmall", PAD, y)
  win:SetHeight(-y + 30)
  win:Hide()
end

function WT.RefreshOptions()
  if not win or not win:IsShown() then return end
  for _, fn in ipairs(controls) do pcall(fn) end
end

function WT.ToggleOptions()
  if not WT.db then return end
  if not win then build() end
  if win:IsShown() then win:Hide() else win:Show(); WT.RefreshOptions() end
end

-- A page under Esc > Options > AddOns that opens the window.
WT.On("PLAYER_LOGIN", function()
  if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then return end
  local page = CreateFrame("Frame")
  label(page, "Warrior Tips", "GameFontNormalLarge", PAD, -16)
  label(page, "Live tips and a report card for warriors. Type /wtips in chat or use the button.", "GameFontHighlight", PAD, -44)
  button(page, "Open Warrior Tips options", PAD, -70, 220, function()
    if SettingsPanel and SettingsPanel.Hide then pcall(SettingsPanel.Hide, SettingsPanel) end
    if not win or not win:IsShown() then WT.ToggleOptions() end
  end)
  local ok, category = pcall(Settings.RegisterCanvasLayoutCategory, page, "Warrior Tips")
  if ok and category then pcall(Settings.RegisterAddOnCategory, category) end
end)
