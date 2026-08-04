const employees = [
  { name: '铁柱', title: '项目协调者', category: 'manage', avatar: 'avatar-01-red.png', accent: '#ffd83d', state: '空闲', summary: '拆解目标、协调成员并保持项目节奏清晰。', detail: '负责澄清目标、安排责任人、同步依赖关系，并在遇到阻塞时及时请求用户确认。', abilities: ['项目协调', '需求澄清', '进度跟踪'] },
  { name: '林默', title: '产品架构师', category: 'manage', avatar: 'avatar-02-cyan.png', accent: '#28cde3', state: '工作中', summary: '把复杂需求整理成可执行的产品结构。', detail: '负责产品边界、信息架构、功能依赖和技术路线，避免团队在模糊目标下直接开工。', abilities: ['产品架构', '方案评审', '系统设计'] },
  { name: '苏晚', title: 'UI/UX 设计师', category: 'design', avatar: 'avatar-07-pink.png', accent: '#f23b31', state: '空闲', summary: '建立完整视觉系统与高效的桌面交互。', detail: '负责视觉语言、组件规范、复杂状态呈现和可用性检查，让太极更像成熟产品。', abilities: ['视觉系统', '交互原型', '设计审查'] },
  { name: '陆远', title: '前端工程师', category: 'dev', avatar: 'avatar-06-blue.png', accent: '#28cde3', state: '等待', summary: '把设计稳定实现为可维护的桌面界面。', detail: '负责 React 前端、Electron 窗口交互、性能优化和响应式布局的工程实现。', abilities: ['React', 'Electron', '性能优化'] },
  { name: '闻舟', title: '后端架构师', category: 'dev', avatar: 'avatar-03-green.png', accent: '#41c978', state: '空闲', summary: '设计服务、数据与任务运行的可靠边界。', detail: '负责服务接口、运行时数据、权限边界和异常恢复，保证执行链路可追踪。', abilities: ['服务设计', '任务运行时', '可靠性'] },
  { name: '程野', title: 'AI 工程师', category: 'data', avatar: 'avatar-04-purple.png', accent: '#ffd83d', state: '工作中', summary: '让模型判断、工具使用与证据形成闭环。', detail: '负责模型路由、上下文管理、工具选择、结果校验与失败后的自主调整。', abilities: ['模型路由', '工具调用', '上下文'] },
  { name: '顾宁', title: '质量审查员', category: 'quality', avatar: 'avatar-05-amber.png', accent: '#f23b31', state: '空闲', summary: '用可核对证据判断任务是否真正完成。', detail: '负责验收标准、回归测试、失败归因和责任步骤退回，避免口头完成。', abilities: ['质量验收', '回归测试', '证据审查'] },
  { name: '叶青', title: '数据工程师', category: 'data', avatar: 'avatar-08-orange.png', accent: '#28cde3', state: '离线', summary: '管理知识、检索和长期记忆的数据基础。', detail: '负责数据建模、知识索引、检索链路和分层记忆的数据质量。', abilities: ['知识索引', '数据建模', '检索优化'] },
];

const SOUND_PRESETS = ['fc', 'mac', 'arcade'];
const VISUAL_STYLES = ['original', 'pop', 'acid'];
const VISUAL_STYLE_LABELS = {
  original: '原版商务',
  pop: '波普漫画',
  acid: '酸性暗黑',
};
const VISUAL_STYLE_BRANDS = {
  original: 'TAIJI OFFICE · ORIGINAL',
  pop: 'POP LAB · UI PROTOTYPE',
  acid: 'ACID SIGNAL · UI PROTOTYPE',
};
const THEME_CATALOG = {
  original: [
    { id: 'light', label: '明亮', colors: ['#f7f8fb', '#ffffff', '#315f91'] },
    { id: 'dark', label: '深色', colors: ['#202124', '#303136', '#4b9cff'] },
    { id: 'eye-care', label: '护眼', colors: ['#e8eee6', '#f4f7f2', '#3f7d5b'] },
    { id: 'soft-gray', label: '柔和灰', colors: ['#eceef1', '#ffffff', '#4b73a9'] },
    { id: 'ocean-blue', label: '海湾蓝', colors: ['#e8f2fb', '#f7fbff', '#1677c8'] },
    { id: 'quiet-blue', label: '静谧蓝', colors: ['#1e2c3c', '#30465c', '#67b7ff'] },
    { id: 'glass-light', label: '玻璃晨光', colors: ['#dfeaf3', '#f9fcff', '#087fc1'] },
    { id: 'glass-dark', label: '玻璃深夜', colors: ['#17212b', '#344555', '#70c5ff'] },
    { id: 'spruce', label: '云杉绿', colors: ['#20332f', '#355149', '#6bc89f'] },
    { id: 'graphite', label: '石墨', colors: ['#303238', '#464a52', '#8ab4f8'] },
    { id: 'cyberpunk', label: '霓虹赛博', colors: ['#070a12', '#20e3ff', '#ff4fd8'] },
  ],
  pop: [
    { id: 'classic', label: '经典波普', colors: ['#f23b31', '#ffd83d', '#28cde3'] },
    { id: 'mono', label: '黑白网点', colors: ['#222222', '#bbbbbb', '#f5f5f5'] },
    { id: 'retro', label: '复古印刷', colors: ['#d94332', '#eabf45', '#4c9ea8'] },
    { id: 'soda', label: '海盐汽水', colors: ['#ff5b5b', '#ffe86a', '#4dd7f3'] },
    { id: 'mint', label: '薄荷草莓', colors: ['#ff5c8a', '#ffe08a', '#73e2c1'] },
    { id: 'citrus', label: '柑橘天空', colors: ['#ff6038', '#ffc928', '#67d7f0'] },
    { id: 'arcade', label: '街机霓虹', colors: ['#ff477e', '#ffd166', '#20c9c3'] },
    { id: 'blueprint', label: '蓝图工坊', colors: ['#ff4d4d', '#ffd447', '#3f8efc'] },
    { id: 'mango', label: '芒果海岸', colors: ['#ef476f', '#ffd23f', '#00b4d8'] },
    { id: 'newsprint', label: '报刊油墨', colors: ['#c83232', '#d9c887', '#476a6f'] },
  ],
  acid: [
    { id: 'acid-lime', label: '核能青柠', colors: ['#070908', '#d8ff65', '#88dca0'] },
    { id: 'acid-magenta', label: '电击洋红', colors: ['#080609', '#ff4fd8', '#b967ff'] },
    { id: 'acid-cyan', label: '液态冰蓝', colors: ['#05090a', '#46e8ff', '#67ffcf'] },
    { id: 'acid-orange', label: '警戒橙', colors: ['#090705', '#ff9d3d', '#ffe45c'] },
  ],
};
const DEFAULT_THEME_BY_STYLE = { original: 'light', pop: 'classic', acid: 'acid-lime' };
const savedVisualStyle = (() => {
  try { return localStorage.getItem('taiji_demo_visual_style'); } catch { return null; }
})();
let activeVisualStyle = VISUAL_STYLES.includes(savedVisualStyle) ? savedVisualStyle : 'pop';

function loadThemeForStyle(style) {
  const available = THEME_CATALOG[style] || [];
  let saved = null;
  try { saved = localStorage.getItem(`taiji_demo_color_theme_${style}`); } catch {}
  if (style === 'pop' && !saved) {
    try { saved = localStorage.getItem('taiji_pop_demo_color_theme'); } catch {}
  }
  return available.some((theme) => theme.id === saved) ? saved : DEFAULT_THEME_BY_STYLE[style];
}

let activeColorTheme = loadThemeForStyle(activeVisualStyle);
const savedSoundPreset = (() => {
  try { return localStorage.getItem('taiji_pop_demo_sound_preset'); } catch { return null; }
})();
const savedSoundVolume = (() => {
  try {
    const value = localStorage.getItem('taiji_pop_demo_sound_volume');
    return value === null ? 80 : Number(value);
  } catch { return 80; }
})();
const savedSoundEnabled = (() => {
  try { return localStorage.getItem('taiji_pop_demo_sound_enabled'); } catch { return null; }
})();
const soundSettings = {
  preset: SOUND_PRESETS.includes(savedSoundPreset) ? savedSoundPreset : 'mac',
  volume: Number.isFinite(savedSoundVolume) ? Math.min(100, Math.max(0, savedSoundVolume)) : 80,
  enabled: savedSoundEnabled === null ? true : savedSoundEnabled !== 'false',
};
let audioContext;

function scheduleTone(start, frequency, duration, type, level, endFrequency = frequency) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), start + Math.min(0.008, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function playSound(kind = 'tap') {
  if (!soundSettings.enabled || soundSettings.volume <= 0) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ??= new AudioContextClass();
  if (audioContext.state === 'suspended') void audioContext.resume();
  const now = audioContext.currentTime + 0.006;
  const level = (soundSettings.volume / 100) * 0.055;

  if (soundSettings.preset === 'fc') {
    const notes = kind === 'success' ? [659, 988, 1318] : kind === 'danger' ? [220, 165] : kind === 'select' ? [523, 784] : [784];
    notes.forEach((frequency, index) => scheduleTone(now + index * 0.045, frequency, 0.052, 'square', level * 0.62));
    return;
  }

  if (soundSettings.preset === 'arcade') {
    if (kind === 'danger') {
      scheduleTone(now, 190, 0.16, 'square', level * 0.7, 85);
      return;
    }
    const notes = kind === 'success' ? [392, 784, 1174] : kind === 'select' ? [330, 660] : [260];
    notes.forEach((frequency, index) => scheduleTone(now + index * 0.055, frequency, kind === 'tap' ? 0.045 : 0.075, 'sawtooth', level * 0.52, frequency * (kind === 'tap' ? 1.35 : 1)));
    return;
  }

  if (kind === 'danger') {
    scheduleTone(now, 330, 0.14, 'triangle', level * 0.8, 210);
  } else if (kind === 'success') {
    scheduleTone(now, 660, 0.12, 'sine', level, 740);
    scheduleTone(now + 0.07, 990, 0.16, 'sine', level * 0.8, 1180);
  } else {
    scheduleTone(now, kind === 'select' ? 540 : 620, kind === 'select' ? 0.09 : 0.055, 'sine', level * 0.78, kind === 'select' ? 880 : 760);
  }
}

function syncSoundControls() {
  document.querySelectorAll('.sound-preset').forEach((button) => button.classList.toggle('active', button.dataset.soundPreset === soundSettings.preset));
  document.querySelector('#soundPresetLabel').textContent = soundSettings.preset.toUpperCase();
  document.querySelector('#soundVolume').value = String(soundSettings.volume);
  document.querySelector('#soundVolumeValue').textContent = `${soundSettings.volume}%`;
  const enabledButton = document.querySelector('#soundEnabled');
  enabledButton.classList.toggle('is-on', soundSettings.enabled);
  enabledButton.setAttribute('aria-checked', String(soundSettings.enabled));
  enabledButton.querySelector('b').textContent = soundSettings.enabled ? '已开启' : '已关闭';
  document.querySelector('#soundPanel').classList.toggle('is-muted', !soundSettings.enabled);
  const trigger = document.querySelector('#soundToggle');
  trigger.innerHTML = `<i data-lucide="${soundSettings.enabled ? 'volume-2' : 'volume-x'}"></i>`;
  trigger.title = soundSettings.enabled ? '互动音效已开启' : '互动音效已关闭';
  if (window.lucide) window.lucide.createIcons();
}

function setSoundPreset(preset) {
  if (!SOUND_PRESETS.includes(preset)) return;
  soundSettings.preset = preset;
  try { localStorage.setItem('taiji_pop_demo_sound_preset', preset); } catch {}
  syncSoundControls();
}

function closeSoundPanel() {
  document.querySelector('#soundPanel').hidden = true;
  document.querySelector('#soundToggle').setAttribute('aria-expanded', 'false');
}

function syncStyleControls() {
  document.body.dataset.style = activeVisualStyle;
  document.querySelectorAll('.style-option').forEach((button) => {
    const selected = button.dataset.styleOption === activeVisualStyle;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('#styleCurrentLabel').textContent = VISUAL_STYLE_LABELS[activeVisualStyle];
  document.querySelector('#brandStyleLabel').textContent = VISUAL_STYLE_BRANDS[activeVisualStyle];
  document.title = `太极 · ${VISUAL_STYLE_LABELS[activeVisualStyle]} UI Demo`;

  const themeTrigger = document.querySelector('#themeToggle');
  themeTrigger.disabled = false;
  themeTrigger.setAttribute('aria-disabled', 'false');
  themeTrigger.title = `${VISUAL_STYLE_LABELS[activeVisualStyle]}配色`;
  document.querySelector('#themePanel').setAttribute('aria-hidden', 'false');
}

function setVisualStyle(style) {
  if (!VISUAL_STYLES.includes(style)) return;
  activeVisualStyle = style;
  activeColorTheme = loadThemeForStyle(style);
  try { localStorage.setItem('taiji_demo_visual_style', style); } catch {}
  syncStyleControls();
  syncThemeControls();
}

function closeStylePanel() {
  document.querySelector('#stylePanel').hidden = true;
  document.querySelector('#styleToggle').setAttribute('aria-expanded', 'false');
}

function syncThemeControls() {
  document.body.dataset.theme = activeColorTheme;
  const themes = THEME_CATALOG[activeVisualStyle] || [];
  document.querySelector('#themePanelTitle').textContent = `${VISUAL_STYLE_LABELS[activeVisualStyle]}配色`;
  document.querySelector('#themeCount').textContent = `${themes.length} 款`;
  document.querySelector('#themeGrid').innerHTML = themes.map((theme) => `
    <button type="button" class="theme-option${theme.id === activeColorTheme ? ' active' : ''}" data-theme-option="${theme.id}" aria-pressed="${theme.id === activeColorTheme}">
      <span class="theme-swatches">${theme.colors.map((color) => `<i style="--swatch:${color}"></i>`).join('')}</span>
      <b>${theme.label}</b>
    </button>
  `).join('');
}

function setColorTheme(theme) {
  if (!(THEME_CATALOG[activeVisualStyle] || []).some((option) => option.id === theme)) return;
  activeColorTheme = theme;
  try { localStorage.setItem(`taiji_demo_color_theme_${activeVisualStyle}`, theme); } catch {}
  syncThemeControls();
}

function closeThemePanel() {
  document.querySelector('#themePanel').hidden = true;
  document.querySelector('#themeToggle').setAttribute('aria-expanded', 'false');
}

const grid = document.querySelector('#officeGrid');
const count = document.querySelector('#employeeCount');

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function renderEmployees(category = 'all') {
  const visible = category === 'all' ? employees : employees.filter((employee) => employee.category === category);
  count.textContent = String(visible.length);
  grid.innerHTML = visible.map((employee, index) => `
    <article class="employee-badge" style="--accent:var(--slot-${index % 4 + 1})" data-index="${index}">
      <span class="badge-strap"></span>
      <div class="badge-inner">
        <section class="badge-face badge-front">
          <header class="badge-head"><span>TAIJI STAFF · ${String(index + 1).padStart(2, '0')}</span><button class="flip-badge" title="查看详细能力">${icon('rotate-3d')}</button></header>
          <div class="badge-body"><div class="badge-avatar"><img src="./assets/${employee.avatar}" alt="${employee.name}"><i class="${employee.state === '工作中' ? 'busy' : employee.state === '等待' ? 'waiting' : employee.state === '离线' ? 'offline' : ''}"></i></div><div><h3 class="badge-name">${employee.name}</h3><p class="badge-title">${employee.title}</p></div></div>
          <p class="badge-summary">${employee.summary}</p>
          <div class="ability-list">${employee.abilities.map((ability) => `<span>${ability}</span>`).join('')}</div>
          <footer class="badge-foot"><span>${employee.state.toUpperCase()}</span><span>TAIJI OFFICE</span></footer>
        </section>
        <section class="badge-face badge-back">
          <header class="badge-head"><span>CAPABILITY FILE</span><button class="flip-badge" title="返回正面">${icon('rotate-3d')}</button></header>
          <div class="badge-back-content"><span class="eyebrow">${employee.title}</span><h3>${employee.name} · 能力档案</h3><p>${employee.detail}</p><div class="ability-list">${employee.abilities.map((ability) => `<span>${ability}</span>`).join('')}</div></div>
          <button class="badge-chat" data-employee="${employee.name}">${icon('message-circle')} 打开私聊</button>
        </section>
      </div>
    </article>
  `).join('');
  if (window.lucide) window.lucide.createIcons();
}

function showView(view, title) {
  document.querySelectorAll('.view-page').forEach((page) => page.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  if (view === 'office') document.querySelector('#officeView').classList.add('active');
  else if (view === 'chat') document.querySelector('#chatView').classList.add('active');
  else {
    document.querySelector('#placeholderView').classList.add('active');
    document.querySelector('#placeholderTitle').textContent = title || '功能预览';
  }
}

function openChat(mode, employeeName) {
  const title = document.querySelector('#chatTitle');
  const subtitle = document.querySelector('#chatSubtitle');
  const badge = document.querySelector('#chatModeBadge');
  const avatar = document.querySelector('#chatAvatar');
  const rail = document.querySelector('#railLabel');
  if (mode === 'team') {
    title.textContent = '太极产品升级组'; badge.textContent = '团队 · 6 人'; badge.style.background = 'var(--yellow)'; avatar.textContent = '组'; rail.textContent = '团队成员';
    subtitle.innerHTML = '<span class="status-dot"></span>1 人执行中 · 3 人等待前置步骤';
  } else if (mode === 'employee') {
    title.textContent = employeeName || '铁柱'; badge.textContent = '员工私聊'; badge.style.background = 'var(--cyan)'; avatar.textContent = (employeeName || '铁柱').slice(0, 1); rail.textContent = '最近对话';
    subtitle.innerHTML = '<span class="status-dot"></span>在线 · 当前空闲';
  } else {
    title.textContent = '章北海助理'; badge.textContent = '助理'; badge.style.background = 'var(--cyan)'; avatar.textContent = '极'; rail.textContent = '最近对话';
    subtitle.innerHTML = '<span class="status-dot"></span>在线 · 可以随时插话';
  }
  showView('chat');
}

function toast(message) {
  const node = document.querySelector('#toast');
  node.querySelector('span').textContent = message;
  node.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

renderEmployees();

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, a');
  if (!event.target.closest('#soundPanel') && !event.target.closest('#soundToggle')) closeSoundPanel();
  if (!event.target.closest('#stylePanel') && !event.target.closest('#styleToggle')) closeStylePanel();
  if (!event.target.closest('#themePanel') && !event.target.closest('#themeToggle')) closeThemePanel();
  if (!target) return;
  if (target.matches('.style-option')) {
    setVisualStyle(target.dataset.styleOption);
    playSound('select');
    closeStylePanel();
    toast(`已切换为${VISUAL_STYLE_LABELS[activeVisualStyle]}风格`);
    return;
  }
  if (target.id === 'styleToggle') {
    const panel = document.querySelector('#stylePanel');
    panel.hidden = !panel.hidden;
    target.setAttribute('aria-expanded', String(!panel.hidden));
    closeSoundPanel();
    closeThemePanel();
    playSound('tap');
    return;
  }
  if (target.matches('.theme-option')) {
    setColorTheme(target.dataset.themeOption);
    playSound('select');
    return;
  }
  if (target.id === 'themeToggle') {
    const panel = document.querySelector('#themePanel');
    panel.hidden = !panel.hidden;
    target.setAttribute('aria-expanded', String(!panel.hidden));
    closeSoundPanel();
    closeStylePanel();
    playSound('tap');
    return;
  }
  if (target.matches('.sound-preset')) {
    setSoundPreset(target.dataset.soundPreset);
    playSound('select');
    return;
  }
  if (target.id === 'soundEnabled') {
    if (soundSettings.enabled) playSound('tap');
    soundSettings.enabled = !soundSettings.enabled;
    try { localStorage.setItem('taiji_pop_demo_sound_enabled', String(soundSettings.enabled)); } catch {}
    syncSoundControls();
    if (soundSettings.enabled) playSound('select');
    return;
  }
  if (target.id === 'soundTest') {
    playSound('success');
    return;
  }
  if (target.id === 'soundToggle') {
    const panel = document.querySelector('#soundPanel');
    panel.hidden = !panel.hidden;
    target.setAttribute('aria-expanded', String(!panel.hidden));
    closeThemePanel();
    closeStylePanel();
    playSound('tap');
    return;
  }
  playSound(target.id === 'approveDemo' ? 'success' : target.classList.contains('stop') ? 'danger' : 'tap');
  if (target.matches('.flip-badge')) target.closest('.employee-badge').classList.toggle('flipped');
  if (target.matches('.badge-chat')) openChat('employee', target.dataset.employee);
  if (target.dataset.chat) openChat(target.dataset.chat);
  if (target.dataset.view) {
    const titles = { analytics: '数据分析', team: '团队大厅', skills: '技能库' };
    showView(target.dataset.view, titles[target.dataset.view]);
  }
  if (target.matches('.category')) {
    document.querySelectorAll('.category').forEach((node) => node.classList.remove('active'));
    target.classList.add('active');
    renderEmployees(target.dataset.category);
  }
  if (target.dataset.scroll) document.querySelector('#categoryScroll').scrollBy({ left: target.dataset.scroll === 'forward' ? 250 : -250, behavior: 'smooth' });
});

document.querySelector('#backOffice').addEventListener('click', () => showView('office'));
document.querySelector('#collapseObserver').addEventListener('click', () => document.querySelector('.chat-layout').classList.add('observer-collapsed'));
document.querySelector('#restoreObserver').addEventListener('click', () => document.querySelector('.chat-layout').classList.remove('observer-collapsed'));
document.querySelector('#toggleLive').addEventListener('click', (event) => {
  document.querySelector('#liveLines').classList.toggle('collapsed');
  event.currentTarget.innerHTML = document.querySelector('#liveLines').classList.contains('collapsed') ? icon('chevron-up') : icon('chevron-down');
  if (window.lucide) window.lucide.createIcons();
});
document.querySelector('#approveDemo').addEventListener('click', () => {
  document.querySelector('.approval-card').style.display = 'none';
  document.querySelector('#approvalReply').classList.remove('is-hidden');
  document.querySelector('#approvalReply').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  toast('方案已批准并关联到任务');
});

document.querySelector('.side-search input').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.mini-employee').forEach((node) => node.hidden = !node.textContent.toLowerCase().includes(query));
});

document.querySelector('#soundVolume').addEventListener('input', (event) => {
  soundSettings.volume = Number(event.target.value);
  document.querySelector('#soundVolumeValue').textContent = `${soundSettings.volume}%`;
  try { localStorage.setItem('taiji_pop_demo_sound_volume', String(soundSettings.volume)); } catch {}
});
document.querySelector('#soundVolume').addEventListener('change', () => playSound('select'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSoundPanel();
    closeStylePanel();
    closeThemePanel();
  }
});

syncThemeControls();
syncStyleControls();
syncSoundControls();
if (window.lucide) window.lucide.createIcons();
