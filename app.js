(() => {
  'use strict';

  const STORAGE_KEY = 'fitness-mini-data-v1';
  const ACTIVE_KEY = 'fitness-mini-active-v1';
  const PLAN_KEY = 'fitness-mini-plans-v1';
  const PARTS = [
    { key: 'chest', name: '胸' }, { key: 'back', name: '背' },
    { key: 'legs', name: '腿' }, { key: 'shoulders', name: '肩' },
    { key: 'arms', name: '手臂' }, { key: 'full', name: '全身' }
  ];

  const app = document.getElementById('app');
  const nav = document.getElementById('bottom-nav');
  const backButton = document.getElementById('back-button');
  const liveBadge = document.getElementById('live-badge');
  const toast = document.getElementById('toast');
  let tickInterval = null;
  let workoutClock = null;
  let toastTimeout = null;
  let timer = { total: 90, remaining: 90, deadline: null, running: false, done: false, started: false };
  let expandedPlanId = null;
  let addPanelOpen = false;
  let editingWeightExerciseId = null;
  let editingRepsSetId = null;

  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const num = value => Math.max(0, Number(value) || 0);
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const localDateKey = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const cleanNumber = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const formatDuration = seconds => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
  const formatDate = (dateKey, withYear = false) => new Intl.DateTimeFormat('zh-CN', { ...(withYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric' }).format(new Date(`${dateKey}T12:00:00`));
  const formatWeekday = (date = new Date()) => new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date);
  const getData = () => readJson(STORAGE_KEY, { workouts: [] });
  const saveData = data => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  function defaultPlans() {
    return {
      chest: { part: '胸', exercises: [
        { id: uid(), name: '卧推', targetSets: 4, targetReps: '8-10', defaultWeight: '' },
        { id: uid(), name: '上斜哑铃卧推', targetSets: 4, targetReps: '8-10', defaultWeight: '' },
        { id: uid(), name: '蝴蝶机夹胸', targetSets: 3, targetReps: '12', defaultWeight: '' },
        { id: uid(), name: '绳索夹胸', targetSets: 3, targetReps: '12-15', defaultWeight: '' }
      ] },
      back: { part: '背', exercises: [] }, legs: { part: '腿', exercises: [] },
      shoulders: { part: '肩', exercises: [] }, arms: { part: '手臂', exercises: [] },
      full: { part: '全身', exercises: [] }
    };
  }

  function getPlans() {
    const saved = readJson(PLAN_KEY, null);
    if (saved) return saved;
    const plans = defaultPlans();
    localStorage.setItem(PLAN_KEY, JSON.stringify(plans));
    return plans;
  }
  const savePlans = plans => localStorage.setItem(PLAN_KEY, JSON.stringify(plans));
  const saveActive = active => active ? localStorage.setItem(ACTIVE_KEY, JSON.stringify(active)) : localStorage.removeItem(ACTIVE_KEY);

  function primarySet(exercise) {
    return exercise?.sets?.reduce((best, set) => {
      if (!best || num(set.weight) > num(best.weight) || (num(set.weight) === num(best.weight) && num(set.reps) > num(best.reps))) return set;
      return best;
    }, null) || null;
  }

  function normalizeActive(active) {
    if (!active || active.partKey) return active;
    active.partKey = 'full'; active.partName = '全身';
    active.exercises = (active.exercises || []).map(exercise => {
      const oldSets = exercise.sets || []; const main = primarySet(exercise);
      return { id: exercise.id || uid(), name: exercise.name, weight: main?.weight ?? '', targetSets: Math.max(1, oldSets.length), targetReps: main?.reps ? String(main.reps) : '', sets: oldSets.map(set => ({ id: set.id || uid(), completed: Boolean(set.completed), reps: set.reps || '' })) };
    });
    saveActive(active); return active;
  }
  const getActive = () => normalizeActive(readJson(ACTIVE_KEY, null));

  function showToast(message) {
    toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function historyFor(name, workouts = getData().workouts) {
    const entries = [];
    workouts.forEach(workout => (workout.exercises || []).forEach(exercise => {
      if (exercise.name.toLocaleLowerCase() === name.toLocaleLowerCase()) entries.push({ workout, exercise });
    }));
    return entries.sort((a, b) => b.workout.date.localeCompare(a.workout.date) || (b.workout.startedAt || 0) - (a.workout.startedAt || 0));
  }
  const lastExercise = name => historyFor(name)[0]?.exercise || null;
  function lastWeight(name) {
    const exercise = lastExercise(name); if (!exercise) return null;
    if (exercise.weight !== undefined && exercise.weight !== '') return num(exercise.weight);
    const set = primarySet(exercise); return set ? num(set.weight) : null;
  }

  function startWorkout() {
    location.hash = getActive() ? '#workout' : '#select'; render();
  }

  function beginPart(partKey) {
    const plan = getPlans()[partKey];
    if (!plan?.exercises.length) {
      location.hash = `#plan/${partKey}`; render(); showToast('先为这个部位添加训练动作'); return;
    }
    const active = {
      id: uid(), date: localDateKey(), startedAt: Date.now(), partKey, partName: plan.part,
      exercises: plan.exercises.map(item => {
        const previous = lastExercise(item.name); const previousWeight = lastWeight(item.name);
        const targetSets = Math.max(1, Number(item.targetSets) || 1);
        return { id: uid(), templateId: item.id, name: item.name, weight: previousWeight ?? item.defaultWeight ?? '', targetSets, targetReps: previous?.targetReps || item.targetReps || '', sets: Array.from({ length: targetSets }, () => ({ id: uid(), completed: false, reps: '' })) };
      })
    };
    timer = { total: timer.total, remaining: timer.total, deadline: null, running: false, done: false, started: false };
    editingWeightExerciseId = null; editingRepsSetId = null;
    saveActive(active); location.hash = '#workout'; render();
  }

  const completedSetCount = exercise => exercise.sets.filter(set => set.completed).length;
  const isExerciseComplete = exercise => exercise.sets.length > 0 && completedSetCount(exercise) === exercise.sets.length;
  const isWorkoutComplete = active => Boolean(active?.exercises.length) && active.exercises.every(isExerciseComplete);

  function metricsForExercise(entries) {
    let maxWeight = null; let maxReps = null; let maxVolume = 0;
    entries.forEach(({ exercise }) => {
      let volume = 0;
      (exercise.sets || []).forEach(set => {
        const weight = set.weight !== undefined ? num(set.weight) : num(exercise.weight); const reps = num(set.reps);
        volume += weight * reps;
        if (!maxWeight || weight > maxWeight.weight || (weight === maxWeight.weight && reps > maxWeight.reps)) maxWeight = { weight, reps };
        if (reps > 0 && (!maxReps || reps > maxReps.reps || (reps === maxReps.reps && weight > maxReps.weight))) maxReps = { weight, reps };
      });
      maxVolume = Math.max(maxVolume, volume);
    });
    return { maxWeight: maxWeight || { weight: 0, reps: 0 }, maxReps: maxReps || { weight: 0, reps: 0 }, maxVolume };
  }

  function completeWorkout(allowIncomplete = false) {
    const active = getActive();
    if (!isWorkoutComplete(active) && !allowIncomplete) return;
    const data = getData(); const previous = structuredClone(data.workouts);
    const workout = {
      id: active.id, date: active.date, startedAt: active.startedAt, completedAt: Date.now(), partKey: active.partKey, partName: active.partName,
      durationSec: Math.max(1, Math.round((Date.now() - active.startedAt) / 1000)),
      planProgress: active.exercises.map(exercise => ({ id: exercise.id, name: exercise.name, targetSets: exercise.sets.length, completedSets: completedSetCount(exercise), sets: exercise.sets.map(set => ({ id: set.id, completed: Boolean(set.completed) })) })),
      exercises: active.exercises.filter(exercise => completedSetCount(exercise) > 0).map(exercise => ({ id: exercise.id, name: exercise.name, weight: num(exercise.weight), targetSets: exercise.targetSets, targetReps: exercise.targetReps, completedSets: completedSetCount(exercise), sets: exercise.sets.filter(set => set.completed).map(set => ({ id: set.id, weight: num(exercise.weight), reps: set.reps === '' ? 0 : num(set.reps), actualReps: set.reps === '' ? null : num(set.reps) })) }))
    };
    const prs = [];
    workout.exercises.forEach(exercise => {
      const beforeEntries = historyFor(exercise.name, previous); const before = metricsForExercise(beforeEntries); const current = metricsForExercise([{ workout, exercise }]); const records = [];
      if (current.maxWeight.weight > 0 && (!beforeEntries.length || current.maxWeight.weight > before.maxWeight.weight)) records.push('最高重量');
      if (current.maxReps.reps > 0 && current.maxReps.reps > before.maxReps.reps) records.push('最高次数');
      if (current.maxVolume > 0 && current.maxVolume > before.maxVolume) records.push('训练容量');
      if (records.length) prs.push({ name: exercise.name, records });
    });
    data.workouts.unshift(workout); saveData(data); saveActive(null);
    sessionStorage.setItem('fitness-mini-last-summary', JSON.stringify({ workout, prs }));
    stopIntervals(); timer = { total: timer.total, remaining: timer.total, deadline: null, running: false, done: false, started: false };
    editingWeightExerciseId = null; editingRepsSetId = null;
    location.hash = '#summary'; render();
  }

  function stopIntervals() { clearInterval(tickInterval); clearInterval(workoutClock); tickInterval = null; workoutClock = null; }

  function routeInfo() {
    const raw = (location.hash || '#home').slice(1);
    if (raw.startsWith('exercise/')) return { route: 'exercise', param: decodeURIComponent(raw.slice(9)) };
    if (raw.startsWith('plan/')) return { route: 'plan', param: raw.slice(5) };
    return { route: ['home', 'select', 'workout', 'history', 'pr', 'summary'].includes(raw) ? raw : 'home', param: '' };
  }

  function setChrome(route) {
    const detail = ['exercise', 'summary', 'plan'].includes(route);
    backButton.classList.toggle('hidden', !detail); document.querySelector('.brand').classList.toggle('hidden', detail);
    liveBadge.classList.toggle('hidden', !getActive() || detail); nav.classList.toggle('hidden', route === 'summary' || route === 'plan');
    document.querySelectorAll('.bottom-nav a').forEach(link => {
      const trainingRoute = ['select', 'workout'].includes(route) && link.dataset.route === 'workout';
      link.classList.toggle('active', link.dataset.route === route || trainingRoute || (route === 'exercise' && link.dataset.route === 'history'));
    });
  }

  function render() {
    stopIntervals(); const { route, param } = routeInfo(); app.className = route === 'workout' ? 'workout-main' : ''; setChrome(route);
    if (route === 'home') renderHome(); else if (route === 'select') renderPartSelection(); else if (route === 'plan') renderPlanEditor(param); else if (route === 'workout') renderWorkout(); else if (route === 'history') renderHistory(); else if (route === 'pr') renderPR(); else if (route === 'exercise') renderExerciseHistory(param); else renderSummary();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderHome() {
    const data = getData(); const now = new Date(); const monday = new Date(now);
    monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const week = data.workouts.filter(workout => new Date(`${workout.date}T12:00:00`) >= monday); const minutes = Math.round(week.reduce((sum, workout) => sum + workout.durationSec, 0) / 60); const active = getActive();
    app.innerHTML = `<p class="eyebrow">今天 · ${escapeHtml(formatWeekday(now))}</p><h1 class="page-title">${escapeHtml(formatDate(localDateKey()))}</h1><p class="date-line">为今天的每一组留下记录。</p><section class="start-card"><p>${active ? '继续今天的训练' : '准备好，就开始。'}</p><button class="start-button" data-action="start-workout">${active ? '继续训练' : '开始训练'}</button></section><section class="stats-grid" aria-label="本周数据"><article class="stat-card"><span>本周训练</span><strong>${week.length}</strong><small>次</small></article><article class="stat-card"><span>本周训练时长</span><strong>${minutes}</strong><small>分钟</small></article></section><div class="section-title-row"><h2 class="section-title">最近训练</h2><span class="subtle">最近 3 次</span></div><section class="list-stack">${data.workouts.length ? data.workouts.slice(0, 3).map(workout => `<div class="list-item"><time class="list-date">${escapeHtml(formatDate(workout.date))}</time><div class="list-copy"><strong>${escapeHtml(workout.partName || workout.exercises.map(e => e.name).slice(0, 2).join(' · '))}</strong><span>${workout.exercises.length} 个动作 · ${Math.max(1, Math.round(workout.durationSec / 60))} 分钟</span></div></div>`).join('') : `<div class="empty-state"><strong>还没有训练记录</strong>完成第一次训练后会显示在这里。</div>`}</section>`;
  }

  function renderPartSelection() {
    if (getActive()) { location.hash = '#workout'; return; }
    const plans = getPlans();
    app.innerHTML = `<p class="eyebrow">今日训练</p><h1 class="page-heading">练哪里？</h1><section class="part-grid">${PARTS.map(part => { const count = plans[part.key]?.exercises.length || 0; return `<article class="part-card"><button class="part-start" data-action="select-part" data-part="${part.key}"><strong>${part.name}</strong><span>${count ? `${count} 个动作` : '未设置方案'}</span></button><button class="plan-link" data-action="edit-plan" data-part="${part.key}">编辑方案</button></article>`; }).join('')}</section>`;
  }

  function suggestedExerciseNames(partKey) {
    const plans = getPlans();
    const currentNames = new Set((plans[partKey]?.exercises || []).map(item => item.name.trim().toLocaleLowerCase()));
    const names = []; const seen = new Set(currentNames);
    const workouts = [...getData().workouts].sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0));
    const addName = name => { const clean = String(name || '').trim(); const key = clean.toLocaleLowerCase(); if (clean && !seen.has(key)) { seen.add(key); names.push(clean); } };
    workouts.forEach(workout => workout.exercises.forEach(exercise => addName(exercise.name)));
    Object.values(plans).forEach(plan => plan.exercises.forEach(exercise => addName(exercise.name)));
    return names.slice(0, 8);
  }

  function repRange(value) {
    const parts = String(value || '').split('-').map(item => item.trim()).filter(Boolean);
    return { min: parts[0] || '', max: parts[1] || '' };
  }

  function renderPlanEditor(partKey) {
    const plan = getPlans()[partKey]; if (!plan) { location.hash = '#select'; return; }
    const suggestions = suggestedExerciseNames(partKey);
    app.innerHTML = `<p class="eyebrow">${escapeHtml(plan.part)}部训练</p><h1 class="page-heading">训练方案</h1>
      <section class="plan-list">${plan.exercises.length ? plan.exercises.map((item, index) => {
        const expanded = expandedPlanId === item.id; const reps = repRange(item.targetReps);
        const weightText = item.defaultWeight === '' ? '未设重量' : `${cleanNumber(item.defaultWeight)}kg`;
        return `<article class="plan-item ${expanded ? 'is-expanded' : ''}" data-plan-id="${item.id}">
          <button class="plan-summary" data-action="toggle-plan" data-id="${item.id}" aria-expanded="${expanded}"><span><strong>${escapeHtml(item.name)}</strong><small>${item.targetSets}组 × ${escapeHtml(item.targetReps || '自定')}次 · ${weightText}</small></span><i>${expanded ? '−' : '＋'}</i></button>
          <div class="plan-order"><button data-action="move-plan" data-direction="up" data-part="${partKey}" data-id="${item.id}" ${index === 0 ? 'disabled' : ''} aria-label="上移${escapeHtml(item.name)}">↑</button><button data-action="move-plan" data-direction="down" data-part="${partKey}" data-id="${item.id}" ${index === plan.exercises.length - 1 ? 'disabled' : ''} aria-label="下移${escapeHtml(item.name)}">↓</button></div>
          ${expanded ? `<div class="plan-editor"><label class="plan-name"><span>动作名称</span><input class="plan-input" data-part="${partKey}" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}" maxlength="30"></label>
            <div class="compact-control"><span>目标组数</span><div class="stepper"><button data-action="step-plan" data-part="${partKey}" data-id="${item.id}" data-field="targetSets" data-delta="-1" aria-label="减少组数">−</button><strong>${item.targetSets}</strong><button data-action="step-plan" data-part="${partKey}" data-id="${item.id}" data-field="targetSets" data-delta="1" aria-label="增加组数">＋</button></div></div>
            <div class="compact-control"><span>默认重量</span><div class="stepper weight-stepper"><button data-action="step-plan" data-part="${partKey}" data-id="${item.id}" data-field="defaultWeight" data-delta="-2.5" aria-label="减少重量">−</button><strong>${cleanNumber(item.defaultWeight)}kg</strong><button data-action="step-plan" data-part="${partKey}" data-id="${item.id}" data-field="defaultWeight" data-delta="2.5" aria-label="增加重量">＋</button></div></div>
            <label class="rep-range"><span>目标次数</span><div><input class="rep-bound-input" type="number" inputmode="numeric" min="1" data-part="${partKey}" data-id="${item.id}" data-bound="min" value="${escapeHtml(reps.min)}" placeholder="12" aria-label="最低次数"><b>−</b><input class="rep-bound-input" type="number" inputmode="numeric" min="1" data-part="${partKey}" data-id="${item.id}" data-bound="max" value="${escapeHtml(reps.max)}" placeholder="可选" aria-label="最高次数"></div></label>
            <button class="remove-plan" data-action="delete-plan-exercise" data-part="${partKey}" data-id="${item.id}">删除动作</button></div>` : ''}
        </article>`;
      }).join('') : `<div class="empty-state"><strong>这个方案还是空的</strong>在下方添加第一个动作。</div>`}</section>
      ${addPanelOpen ? `<section class="add-plan-panel"><h2>添加动作</h2>${suggestions.length ? `<p class="field-label">最近使用</p><div class="exercise-picks">${suggestions.map(name => `<button data-action="add-existing-plan" data-part="${partKey}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}</div>` : ''}<p class="field-label">自定义动作</p><div class="custom-action-row"><input id="new-plan-name" maxlength="30" placeholder="动作名称"><button data-action="add-plan-exercise" data-part="${partKey}">添加</button></div></section>` : ''}
      <div class="plan-footer"><button class="add-exercise" data-action="toggle-add-panel">${addPanelOpen ? '收起添加动作' : '＋ 添加动作'}</button><button class="primary-button" data-action="save-plan" data-part="${partKey}">保存方案</button></div>`;
  }

  function renderWorkout() {
    clearInterval(workoutClock); const active = getActive();
    if (!active) { location.hash = '#select'; render(); return; }
    app.innerHTML = `<div class="workout-head"><div><p class="eyebrow">${escapeHtml(active.partName)}部训练</p><h1 class="page-title">训练中</h1></div><div class="workout-time"><span>训练时长</span><strong id="workout-time">${formatDuration((Date.now() - active.startedAt) / 1000)}</strong></div></div><section id="exercise-list">${active.exercises.map(renderWorkoutExercise).join('')}</section><button class="finish-button" data-action="finish-workout">结束训练</button>${renderTimer()}`;
    workoutClock = setInterval(() => { const el = document.getElementById('workout-time'); if (el) el.textContent = formatDuration((Date.now() - active.startedAt) / 1000); }, 1000); updateTimerUI(); if (timer.running) runTimerTick();
  }

  function renderWorkoutExercise(exercise) {
    const done = completedSetCount(exercise); const complete = isExerciseComplete(exercise); const editingWeight = editingWeightExerciseId === exercise.id;
    return `<article class="exercise-card compact-exercise ${complete ? 'exercise-complete' : ''}" data-exercise-id="${exercise.id}">
      <div class="exercise-heading compact-heading"><h2 class="exercise-name">${escapeHtml(exercise.name)}</h2><span class="set-progress ${complete ? 'is-complete' : ''}">${complete ? '动作完成' : `${done}/${exercise.sets.length}组`}</span></div>
      <div class="quick-training-meta"><div class="workout-weight-stepper"><button data-action="step-workout-weight" data-exercise="${exercise.id}" data-delta="-2.5" aria-label="${escapeHtml(exercise.name)}减少2.5公斤">−2.5</button>${editingWeight ? `<input class="exercise-weight-input" type="number" inputmode="decimal" enterkeyhint="done" min="0" step="0.5" data-exercise="${exercise.id}" value="${escapeHtml(exercise.weight)}" placeholder="0" aria-label="${escapeHtml(exercise.name)}今天重量">` : `<button class="weight-value" data-action="edit-workout-weight" data-exercise="${exercise.id}" aria-label="手动修改${escapeHtml(exercise.name)}重量">${cleanNumber(exercise.weight)}kg</button>`}<button data-action="step-workout-weight" data-exercise="${exercise.id}" data-delta="2.5" aria-label="${escapeHtml(exercise.name)}增加2.5公斤">＋2.5</button></div><span class="compact-target">目标 ${escapeHtml(exercise.targetReps || '自定')}次</span></div>
      <div class="check-sets compact-sets">${exercise.sets.map((set, index) => {
        const editingReps = editingRepsSetId === set.id;
        return `<div class="check-set-row ${set.completed ? 'is-done' : ''}"><button class="set-check" data-action="toggle-set" data-exercise="${exercise.id}" data-set="${set.id}" aria-label="${set.completed ? '取消' : '完成'}${escapeHtml(exercise.name)}第${index + 1}组">${set.completed ? '✓' : ''}</button><strong>第${index + 1}组</strong>${set.completed ? (editingReps ? `<label class="actual-reps optional-reps"><input class="actual-reps-input" type="number" inputmode="numeric" min="0" step="1" data-exercise="${exercise.id}" data-set="${set.id}" value="${escapeHtml(set.reps)}" placeholder="次数" aria-label="${escapeHtml(exercise.name)}第${index + 1}组实际次数"><i>次</i></label>` : `<button class="record-reps" data-action="edit-set-reps" data-set="${set.id}">${set.reps === '' ? '记录次数' : `${cleanNumber(set.reps)}次`}</button>`) : ''}</div>`;
      }).join('')}</div>
    </article>`;
  }

  function renderTimer() {
    const activeRest = timer.started || timer.done;
    return `<aside class="timer-dock compact-timer ${activeRest ? 'timer-active' : 'timer-idle'}" id="timer-dock" aria-label="组间休息计时器"><div class="timer-status"><span class="timer-label" id="timer-label">${timer.done ? '休息结束' : (timer.started ? (timer.running ? '休息中' : '已暂停') : '休息')}</span><strong class="timer-display" id="timer-display">${activeRest ? formatDuration(timer.remaining) : `${timer.total}秒`}</strong></div>${activeRest ? `<div class="timer-actions"><button data-action="timer-toggle">${timer.running ? '暂停' : '继续'}</button><button data-action="timer-add">＋30秒</button><button data-action="timer-skip">${timer.done ? '关闭' : '跳过'}</button></div>` : `<div class="timer-presets">${[60,90,120,180].map(seconds => `<button data-action="timer-select" data-seconds="${seconds}" class="${timer.total === seconds ? 'active' : ''}">${seconds}</button>`).join('')}</div>`}</aside>`;
  }

  function refreshTimerDock() { const dock = document.getElementById('timer-dock'); if (dock) dock.outerHTML = renderTimer(); }
  function startTimer(seconds) { timer = { total: seconds, remaining: seconds, deadline: Date.now() + seconds * 1000, running: true, done: false, started: true }; refreshTimerDock(); runTimerTick(); updateTimerUI(); }
  function runTimerTick() {
    clearInterval(tickInterval); if (!timer.running) return;
    tickInterval = setInterval(() => { timer.remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000)); if (timer.remaining <= 0) { timer.running = false; timer.done = true; timer.started = false; clearInterval(tickInterval); refreshTimerDock(); if ('vibrate' in navigator) navigator.vibrate([300, 150, 300]); showToast('休息结束 · 开始下一组'); } updateTimerUI(); }, 250);
  }
  function updateTimerUI() {
    const display = document.getElementById('timer-display'); const label = document.getElementById('timer-label'); const dock = document.getElementById('timer-dock'); if (!display) return;
    display.textContent = (timer.started || timer.done) ? formatDuration(timer.remaining) : `${timer.total}秒`; label.textContent = timer.done ? '休息结束' : (timer.started ? (timer.running ? '休息中' : '已暂停') : '休息'); label.classList.toggle('timer-done', timer.done); dock.classList.toggle('is-done', timer.done);
    const toggle = dock.querySelector('[data-action="timer-toggle"]'); if (toggle) toggle.textContent = timer.running ? '暂停' : '继续'; dock.querySelectorAll('[data-seconds]').forEach(button => button.classList.toggle('active', Number(button.dataset.seconds) === timer.total));
  }

  function renderHistory() {
    const data = getData(); const names = [...new Set(data.workouts.flatMap(workout => workout.exercises.map(exercise => exercise.name)))];
    app.innerHTML = `<p class="eyebrow">训练档案</p><h1 class="page-heading">动作历史</h1><section class="list-stack">${names.length ? names.map(name => { const entries = historyFor(name, data.workouts); const totalSets = entries.reduce((sum, item) => sum + item.exercise.sets.length, 0); return `<a class="list-item" href="#exercise/${encodeURIComponent(name)}"><div class="list-copy"><strong>${escapeHtml(name)}</strong><span>${entries.length} 次训练 · ${totalSets} 组</span></div><span class="chevron">›</span></a>`; }).join('') : `<div class="empty-state"><strong>还没有动作历史</strong>完成训练后，每个动作的历史会出现在这里。</div>`}</section>`;
  }
  function setHistoryText(set, exercise) { const weight = set.weight !== undefined ? num(set.weight) : num(exercise.weight); return num(set.reps) > 0 ? `${cleanNumber(weight)}kg × ${cleanNumber(set.reps)}` : `${cleanNumber(weight)}kg · 已完成`; }
  function renderExerciseHistory(name) {
    const entries = historyFor(name); if (!entries.length) { location.hash = '#history'; return; }
    const latestExercise = entries[0].exercise; const latestSet = primarySet(latestExercise) || { weight: latestExercise.weight || 0, reps: 0 }; const metrics = metricsForExercise(entries);
    app.innerHTML = `<p class="eyebrow">动作历史</p><h1 class="page-heading">${escapeHtml(name)}</h1><section class="history-hero"><article class="metric-card"><span>上次训练</span><strong>${num(latestSet.reps) > 0 ? `${cleanNumber(latestSet.weight)}kg × ${cleanNumber(latestSet.reps)}` : `${cleanNumber(latestSet.weight)}kg`}</strong></article><article class="metric-card"><span>历史最佳</span><strong>${cleanNumber(metrics.maxWeight.weight)}kg${metrics.maxWeight.reps ? ` × ${cleanNumber(metrics.maxWeight.reps)}` : ''}</strong></article></section><section>${entries.map(({ workout, exercise }) => `<article class="history-block"><time>${escapeHtml(formatDate(workout.date, new Date().getFullYear() !== Number(workout.date.slice(0,4))))}${workout.partName ? ` · ${escapeHtml(workout.partName)}` : ''}</time>${exercise.sets.map(set => `<div class="history-set">${setHistoryText(set, exercise)}</div>`).join('')}</article>`).join('')}</section>`;
  }
  function renderPR() {
    const data = getData(); const names = [...new Set(data.workouts.flatMap(workout => workout.exercises.map(exercise => exercise.name)))];
    app.innerHTML = `<p class="eyebrow">个人纪录</p><h1 class="page-heading">PR</h1><section>${names.length ? names.map(name => { const metrics = metricsForExercise(historyFor(name, data.workouts)); return `<article class="pr-card"><div class="pr-title"><h2>${escapeHtml(name)}</h2><span class="trophy">◆</span></div><div class="pr-metrics"><div class="pr-metric"><span>最高重量</span><strong>${cleanNumber(metrics.maxWeight.weight)} kg</strong></div><div class="pr-metric"><span>最高单组次数</span><strong>${metrics.maxReps.reps ? `${cleanNumber(metrics.maxReps.weight)}kg × ${cleanNumber(metrics.maxReps.reps)}` : '未记录'}</strong></div><div class="pr-metric"><span>最大单次训练容量</span><strong>${cleanNumber(metrics.maxVolume)} kg</strong></div></div></article>`; }).join('') : `<div class="empty-state"><strong>PR 从第一次训练开始</strong>完成训练后会自动计算，无需手动填写。</div>`}</section>`;
  }
  function renderSummary() {
    let summary = null; try { summary = JSON.parse(sessionStorage.getItem('fitness-mini-last-summary')); } catch {} if (!summary) { location.hash = '#home'; return; }
    const { workout, prs } = summary;
    app.innerHTML = `<section class="summary-hero">${prs.length ? `<p class="celebrate">🎉 NEW PR</p>` : ''}<h1>训练完成</h1><p>${escapeHtml(workout.partName || '')} · ${Math.max(1, Math.round(workout.durationSec / 60))} 分钟 · ${workout.exercises.length} 个动作</p></section>${prs.length ? `<section class="summary-section"><div class="section-title-row"><h2 class="section-title">今日新纪录</h2></div><div class="list-stack">${prs.map(pr => `<div class="list-item"><div class="list-copy"><strong>${escapeHtml(pr.name)}</strong><span>${pr.records.join(' · ')}</span></div></div>`).join('')}</div></section>` : ''}<section class="summary-section"><div class="section-title-row"><h2 class="section-title">训练内容</h2></div>${workout.exercises.map(exercise => `<article class="history-block"><time>${escapeHtml(exercise.name)} · ${exercise.completedSets} 组</time>${exercise.sets.map(set => `<div class="history-set">${setHistoryText(set, exercise)}</div>`).join('')}</article>`).join('')}</section><button class="primary-button" data-action="summary-home">回到首页</button>`;
  }

  function mutateActive(callback) { const active = getActive(); if (!active) return null; const result = callback(active); saveActive(active); return result; }

  app.addEventListener('input', event => {
    const weight = event.target.closest('.exercise-weight-input');
    if (weight) mutateActive(active => { const exercise = active.exercises.find(item => item.id === weight.dataset.exercise); if (exercise) exercise.weight = weight.value; });
    const reps = event.target.closest('.actual-reps-input');
    if (reps) mutateActive(active => { const exercise = active.exercises.find(item => item.id === reps.dataset.exercise); const set = exercise?.sets.find(item => item.id === reps.dataset.set); if (set) set.reps = reps.value; });
    const planInput = event.target.closest('.plan-input');
    if (planInput) { const plans = getPlans(); const exercise = plans[planInput.dataset.part]?.exercises.find(item => item.id === planInput.dataset.id); if (exercise) { const field = planInput.dataset.field; exercise[field] = field === 'targetSets' ? Math.max(1, Number(planInput.value) || 1) : planInput.value; savePlans(plans); } }
    const repInput = event.target.closest('.rep-bound-input');
    if (repInput) {
      const plans = getPlans(); const exercise = plans[repInput.dataset.part]?.exercises.find(item => item.id === repInput.dataset.id);
      if (exercise) {
        const editor = repInput.closest('.rep-range'); const min = editor.querySelector('[data-bound="min"]').value.trim(); const max = editor.querySelector('[data-bound="max"]').value.trim();
        exercise.targetReps = min ? (max && max !== min ? `${min}-${max}` : min) : max; savePlans(plans);
        const summary = repInput.closest('.plan-item').querySelector('.plan-summary small');
        if (summary) summary.textContent = `${exercise.targetSets}组 × ${exercise.targetReps || '自定'}次 · ${exercise.defaultWeight === '' ? '未设重量' : `${cleanNumber(exercise.defaultWeight)}kg`}`;
      }
    }
  });

  app.addEventListener('keydown', event => {
    const weight = event.target.closest('.exercise-weight-input');
    if (weight && event.key === 'Enter') { event.preventDefault(); editingWeightExerciseId = null; renderWorkout(); }
  });

  app.addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return; const action = button.dataset.action;
    if (action === 'start-workout') startWorkout();
    if (action === 'select-part') beginPart(button.dataset.part);
    if (action === 'edit-plan') location.hash = `#plan/${button.dataset.part}`;
    if (action === 'toggle-plan') { expandedPlanId = expandedPlanId === button.dataset.id ? null : button.dataset.id; renderPlanEditor(routeInfo().param); }
    if (action === 'toggle-add-panel') { addPanelOpen = !addPanelOpen; renderPlanEditor(routeInfo().param); }
    if (action === 'save-plan') { expandedPlanId = null; addPanelOpen = false; location.hash = '#select'; showToast('训练方案已保存'); }
    if (action === 'step-plan') {
      const plans = getPlans(); const exercise = plans[button.dataset.part]?.exercises.find(item => item.id === button.dataset.id);
      if (exercise) { const field = button.dataset.field; const delta = Number(button.dataset.delta); const floor = field === 'targetSets' ? 1 : 0; exercise[field] = Math.max(floor, num(exercise[field]) + delta); savePlans(plans); expandedPlanId = exercise.id; renderPlanEditor(button.dataset.part); }
    }
    if (action === 'add-existing-plan') {
      const plans = getPlans(); const name = button.dataset.name; const previous = lastExercise(name); const priorWeight = lastWeight(name);
      const item = { id: uid(), name, targetSets: previous?.targetSets || previous?.sets?.length || 3, targetReps: previous?.targetReps || (primarySet(previous)?.reps ? String(primarySet(previous).reps) : '8-10'), defaultWeight: priorWeight ?? '' };
      plans[button.dataset.part].exercises.push(item); savePlans(plans); expandedPlanId = null; addPanelOpen = false; renderPlanEditor(button.dataset.part);
    }
    if (action === 'add-plan-exercise') {
      const name = document.getElementById('new-plan-name')?.value.trim(); if (!name) { showToast('请输入动作名称'); return; }
      const plans = getPlans(); plans[button.dataset.part].exercises.push({ id: uid(), name, targetSets: 3, targetReps: '8-10', defaultWeight: '' }); savePlans(plans); expandedPlanId = null; addPanelOpen = false; renderPlanEditor(button.dataset.part);
    }
    if (action === 'delete-plan-exercise' && confirm('从训练方案中删除这个动作？')) { const plans = getPlans(); plans[button.dataset.part].exercises = plans[button.dataset.part].exercises.filter(item => item.id !== button.dataset.id); savePlans(plans); expandedPlanId = null; renderPlanEditor(button.dataset.part); }
    if (action === 'move-plan') { const plans = getPlans(); const list = plans[button.dataset.part].exercises; const from = list.findIndex(item => item.id === button.dataset.id); const to = button.dataset.direction === 'up' ? from - 1 : from + 1; if (from >= 0 && to >= 0 && to < list.length) { [list[from], list[to]] = [list[to], list[from]]; savePlans(plans); renderPlanEditor(button.dataset.part); } }
    if (action === 'step-workout-weight') {
      mutateActive(active => { const exercise = active.exercises.find(item => item.id === button.dataset.exercise); if (exercise) exercise.weight = Math.max(0, num(exercise.weight) + Number(button.dataset.delta)); });
      editingWeightExerciseId = null; renderWorkout();
    }
    if (action === 'edit-workout-weight') {
      editingWeightExerciseId = button.dataset.exercise; renderWorkout();
      requestAnimationFrame(() => { const input = document.querySelector(`.exercise-weight-input[data-exercise="${button.dataset.exercise}"]`); input?.focus(); input?.select(); });
    }
    if (action === 'edit-set-reps') {
      editingRepsSetId = button.dataset.set; renderWorkout();
      requestAnimationFrame(() => { const input = document.querySelector(`.actual-reps-input[data-set="${button.dataset.set}"]`); input?.focus(); input?.select(); });
    }
    if (action === 'toggle-set') {
      const result = mutateActive(active => { const exercise = active.exercises.find(item => item.id === button.dataset.exercise); const set = exercise?.sets.find(item => item.id === button.dataset.set); if (!set) return null; set.completed = !set.completed; return { completed: set.completed, setId: set.id }; });
      if (result && !result.completed && editingRepsSetId === result.setId) editingRepsSetId = null;
      renderWorkout(); if (result?.completed) startTimer(timer.total);
    }
    if (action === 'finish-workout') {
      const active = getActive(); if (!active) return;
      if (isWorkoutComplete(active)) { completeWorkout(); return; }
      const completed = active.exercises.reduce((sum, exercise) => sum + completedSetCount(exercise), 0);
      const total = active.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
      if (confirm(`结束训练？\n\n已完成 ${completed}/${total} 组\n未完成组会保留为未完成，不会计入训练数据。`)) completeWorkout(true);
    }
    if (action === 'summary-home') { sessionStorage.removeItem('fitness-mini-last-summary'); location.hash = '#home'; }
    if (action === 'timer-select') { timer = { total: Number(button.dataset.seconds), remaining: Number(button.dataset.seconds), deadline: null, running: false, done: false, started: false }; refreshTimerDock(); updateTimerUI(); }
    if (action === 'timer-toggle') { if (timer.running) { timer.remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000)); timer.running = false; clearInterval(tickInterval); } else if (timer.remaining > 0) { timer.running = true; timer.started = true; timer.done = false; timer.deadline = Date.now() + timer.remaining * 1000; runTimerTick(); } refreshTimerDock(); updateTimerUI(); }
    if (action === 'timer-add') { timer.remaining += 30; timer.done = false; if (timer.running) timer.deadline += 30000; updateTimerUI(); }
    if (action === 'timer-skip') { clearInterval(tickInterval); timer = { total: timer.total, remaining: timer.total, deadline: null, running: false, done: false, started: false }; refreshTimerDock(); updateTimerUI(); }
  });

  backButton.addEventListener('click', () => { const route = routeInfo().route; location.hash = route === 'summary' ? '#home' : (route === 'plan' ? '#select' : '#history'); });
  window.addEventListener('hashchange', render);

  function registerWebMCP() {
    const context = document.modelContext; if (!context?.registerTool) return;
    const tools = [
      { name: 'start_workout', title: '开始训练', description: '打开今日训练部位选择；若已有训练则继续。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: () => { startWorkout(); return { status: getActive() ? 'active' : 'select_part' }; } },
      { name: 'read_training_summary', title: '读取训练概况', description: '读取本地保存的训练次数和动作数量。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => { const data = getData(); return { workouts: data.workouts.length, exercises: new Set(data.workouts.flatMap(w => w.exercises.map(e => e.name))).size, active: Boolean(getActive()) }; } }
    ];
    tools.forEach(tool => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {} });
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  registerWebMCP(); render();
})();
