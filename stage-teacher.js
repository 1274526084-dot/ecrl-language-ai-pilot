'use strict';

(() => {
  const API_URL = 'https://cloudbase-d3gxxe4l88c3d5907-1431364187.ap-shanghai.app.tcloudbase.com/ecrl/lesson8';
  const LESSONS = { '8': '旧梦', '9': '爱的教育', '10': '快乐其实很简单' };
  const DIMENSIONS = { vocabulary: '词语', grammar: '语法', reading: '阅读' };
  const state = { password: '', records: [], groups: [], epoch: 0, activeStudent: '', activeDocument: '', saving: false, loading: false };
  const requests = new Set();
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const lessonId = record => String(record.lessonId ?? '');
  const lessonName = record => `第${lessonId(record)}课 · ${record.lessonTitle || LESSONS[lessonId(record)] || '阶段测试'}`;
  const submittedTime = record => Number.isFinite(Date.parse(record.submittedAt)) ? Date.parse(record.submittedAt) : 0;
  const newestFirst = (left, right) => submittedTime(right) - submittedTime(left) || String(right.attemptId || right.documentId).localeCompare(String(left.attemptId || left.documentId));
  const isGraded = record => record.gradingStatus === 'graded' && number(record.writingScore) !== null;
  const textScore = (score, max) => number(score) === null ? '—' : `${score} / ${max}`;
  const displayDate = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未记录';
  const className = record => String(record.student?.className || '未填写班级');
  const sourceText = source => typeof source === 'string' ? source : Array.isArray(source) ? source.map(sourceText).join('；') : source && typeof source === 'object' ? [source.book, source.page, source.exercise, source.note].filter(Boolean).join(' · ') : '';

  function setMessage(id, message, type = '') {
    const target = byId(id);
    target.textContent = message;
    target.className = `message${type ? ` ${type}` : ''}`;
  }

  function clearVisibleData() {
    if (byId('detailDialog').open) byId('detailDialog').close();
    state.records = [];
    state.groups = [];
    state.activeStudent = '';
    state.activeDocument = '';
    state.saving = false;
    ['classSummaryRows', 'studentRows', 'attemptHistory', 'attemptDetail'].forEach(id => byId(id).replaceChildren());
    ['detailTitle', 'detailIdentity', 'syncMessage', 'filterSummary', 'rowCount'].forEach(id => { byId(id).textContent = ''; });
    ['studentCount', 'latestCount', 'pendingCount', 'attemptCount'].forEach(id => { byId(id).textContent = '0'; });
    byId('classFilter').replaceChildren(new Option('全部班级', ''));
    byId('gradeForm').reset();
    ['contentScore', 'grammarScore', 'expressionScore', 'gradeFeedback'].forEach(id => { byId(id).disabled = false; });
    setMessage('gradeMessage', '');
    byId('gradeTotal').textContent = '填写三个分项后显示短表达总分。';
    byId('saveGrade').disabled = false;
    byId('saveGrade').textContent = '保存批改到云端';
    byId('appView').hidden = true;
    byId('loginView').hidden = false;
  }

  function endSession(message = '', type = '') {
    state.epoch += 1;
    requests.forEach(controller => controller.abort());
    requests.clear();
    state.password = '';
    state.loading = false;
    clearVisibleData();
    byId('teacherPassword').value = '';
    byId('searchInput').value = '';
    byId('lessonFilter').value = '';
    byId('loginButton').disabled = false;
    byId('cancelLoad').hidden = true;
    setMessage('loginMessage', message, type);
  }

  async function callApi(payload) {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('云端返回了无法读取的内容，请稍后重试。'); }
      if (!response.ok || result?.ok !== true) {
        const error = new Error(response.status === 401 ? '教师密码不正确或已失效。' : response.status === 409 ? '这份作答已被其他批改操作更新，请重新读取后再批改。' : String(result?.message || '云端请求失败，请稍后重试。'));
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('读取超时或操作已取消，请重试。');
      if (error instanceof TypeError) throw new Error('无法连接云端，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }

  function rebuildGroups() {
    const grouped = new Map();
    state.records.forEach(record => {
      // Missing identifiers never cause unrelated students to be merged.
      const key = String(record.studentKey || `record:${record.documentId}`);
      if (!grouped.has(key)) grouped.set(key, { key, records: [], latest: new Map() });
      grouped.get(key).records.push(record);
    });
    state.groups = [...grouped.values()].map(group => {
      group.records.sort(newestFirst);
      group.identity = group.records[0].student || {};
      group.className = className(group.records[0]);
      group.records.forEach(record => { if (!group.latest.has(lessonId(record))) group.latest.set(lessonId(record), record); });
      return group;
    }).sort((left, right) => left.className.localeCompare(right.className, 'zh-CN') || String(left.identity.studentNumber || '').localeCompare(String(right.identity.studentNumber || ''), 'zh-CN', { numeric: true }) || String(left.identity.name || '').localeCompare(String(right.identity.name || ''), 'zh-CN'));
  }

  function matchingGroups() {
    const query = byId('searchInput').value.trim().toLocaleLowerCase();
    const selectedClass = byId('classFilter').value;
    const selectedLesson = byId('lessonFilter').value;
    return state.groups.filter(group => {
      const searchable = group.records.map(record => [record.student?.name, record.student?.studentNumber, record.student?.className].join(' ')).join(' ').toLocaleLowerCase();
      return (!query || searchable.includes(query)) && (!selectedClass || group.className === selectedClass) && (!selectedLesson || group.latest.has(selectedLesson));
    });
  }

  function scopedRecords(groups, latestOnly) {
    const selectedLesson = byId('lessonFilter').value;
    return groups.flatMap(group => latestOnly ? [...group.latest.values()] : group.records).filter(record => !selectedLesson || lessonId(record) === selectedLesson);
  }

  function updateClassOptions(selectedClass = '') {
    const classes = [...new Set(state.groups.map(group => group.className))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    byId('classFilter').replaceChildren(new Option('全部班级', ''), ...classes.map(value => new Option(value, value)));
    if (classes.includes(selectedClass)) byId('classFilter').value = selectedClass;
  }

  function scoreCell(record) {
    if (!record) return '<span class="muted small">尚未提交</span>';
    const objective = number(record.objectiveScore);
    return `<div class="score-line"><strong>${objective === null ? '—' : objective}</strong><span>/ 80 客观题</span></div>${isGraded(record) ? `<div class="score-detail">短表达 ${esc(textScore(record.writingScore, 20))} · 总分 ${esc(textScore(record.totalScore, 100))}</div><span class="status graded">已批改</span>` : '<span class="status pending">短表达待批改</span>'}`;
  }

  function renderDashboard() {
    const groups = matchingGroups();
    const latest = scopedRecords(groups, true);
    const all = scopedRecords(groups, false);
    byId('studentCount').textContent = groups.length;
    byId('latestCount').textContent = latest.length;
    byId('pendingCount').textContent = latest.filter(record => !isGraded(record)).length;
    byId('attemptCount').textContent = all.length;
    byId('rowCount').textContent = `${groups.length} 位学生`;
    byId('filterSummary').textContent = `当前筛选：${groups.length} 位学生，${latest.length} 份最新提交，${all.length} 份历次提交。`;
    byId('exportButton').disabled = all.length === 0;
    const summary = new Map();
    latest.forEach(record => {
      const key = JSON.stringify([className(record), lessonId(record)]);
      if (!summary.has(key)) summary.set(key, { className: className(record), lessonId: lessonId(record), records: [] });
      summary.get(key).records.push(record);
    });
    const summaryRows = [...summary.values()].sort((a, b) => a.className.localeCompare(b.className, 'zh-CN') || Number(a.lessonId) - Number(b.lessonId));
    byId('classSummaryRows').innerHTML = summaryRows.map(row => {
      const scores = row.records.map(record => number(record.objectiveScore)).filter(score => score !== null);
      const mean = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : '—';
      const versions = [...new Set(row.records.map(record => String(record.version || '未记录')))];
      return `<tr><td>${esc(row.className)}</td><td>${esc(lessonName(row.records[0]))}</td><td>${row.records.length}</td><td><strong>${mean}</strong></td><td>${row.records.filter(record => !isGraded(record)).length}</td><td>${esc(versions.join('、'))}${versions.length > 1 ? '<div class="small muted">含不同版本，请分别核对试题</div>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">当前没有符合筛选条件的提交。</td></tr>';
    byId('studentRows').innerHTML = groups.map((group, index) => `<tr><td><div class="student-name">${esc(group.identity.name || '未填写姓名')}</div><div class="student-number">${esc(group.identity.studentNumber || '未填写学号')}</div></td><td>${esc(group.className)}</td>${['8', '9', '10'].map(id => `<td>${scoreCell(group.latest.get(id))}</td>`).join('')}<td><button class="button secondary view-button" type="button" data-student-index="${index}">查看 / 批改</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">尚无学生记录，或没有匹配的学生。</td></tr>';
    byId('studentRows').querySelectorAll('[data-student-index]').forEach(button => button.addEventListener('click', () => openStudent(groups[Number(button.dataset.studentIndex)])));
  }

  async function loadAllRecords() {
    if (state.loading || !state.password) return;
    const epoch = ++state.epoch;
    const password = state.password;
    const selectedClass = byId('classFilter').value;
    state.loading = true;
    clearVisibleData();
    byId('teacherPassword').value = '';
    byId('loginButton').disabled = true;
    byId('cancelLoad').hidden = false;
    setMessage('loginMessage', '正在验证密码并读取云端记录……');
    const collected = new Map();
    const cursors = new Set();
    let cursor;
    let page = 0;
    try {
      while (true) {
        const result = await callApi({ action: 'stageList', teacherPassword: password, pageSize: 99, ...(cursor ? { cursor } : {}) });
        if (epoch !== state.epoch) return;
        if (!Array.isArray(result.records) || typeof result.hasMore !== 'boolean') throw new Error('云端记录格式不完整，请稍后重试。');
        result.records.forEach(record => {
          if (!record || typeof record !== 'object' || !record.documentId || !record.studentKey) throw new Error('云端返回了缺少标识的记录，请联系管理员核对。');
          const existing = collected.get(String(record.documentId));
          if (!existing || Number(record.gradeRevision || 0) >= Number(existing.gradeRevision || 0)) collected.set(String(record.documentId), record);
        });
        page += 1;
        setMessage('loginMessage', `正在读取全部记录……已读取 ${collected.size} 份（第 ${page} 页）。`);
        if (!result.hasMore) break;
        if (!result.nextCursor || cursors.has(String(result.nextCursor))) throw new Error('云端分页未能继续，尚未取得全部记录，请重试。');
        cursor = result.nextCursor;
        cursors.add(String(cursor));
      }
      if (epoch !== state.epoch) return;
      state.records = [...collected.values()].sort(newestFirst);
      rebuildGroups();
      updateClassOptions(selectedClass);
      renderDashboard();
      byId('syncMessage').textContent = `已完整读取 ${state.records.length} 份云端记录 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
      byId('loginView').hidden = true;
      byId('appView').hidden = false;
      setMessage('loginMessage', '');
    } catch (error) {
      if (epoch === state.epoch) endSession(`${error.message} 为避免显示过期数据，本页已清除当前查看结果，请重新登录。`, 'error');
    } finally {
      if (epoch === state.epoch) {
        state.loading = false;
        byId('loginButton').disabled = false;
        byId('cancelLoad').hidden = true;
      }
    }
  }

  function openStudent(group, documentId) {
    if (!group) return;
    state.activeStudent = group.key;
    byId('detailTitle').textContent = group.identity.name || '未填写姓名';
    byId('detailIdentity').textContent = `${group.className} · 学号 ${group.identity.studentNumber || '未填写'} · 身份自报`;
    const chosen = documentId && group.records.find(record => record.documentId === documentId) || group.latest.get(byId('lessonFilter').value) || group.records[0];
    state.activeDocument = chosen.documentId;
    renderHistory(group);
    renderAttempt(chosen);
    if (!byId('detailDialog').open) byId('detailDialog').showModal();
  }

  function renderHistory(group) {
    byId('attemptHistory').innerHTML = group.records.map((record, index) => `<button type="button" class="history-button${record.documentId === state.activeDocument ? ' active' : ''}" data-attempt-index="${index}" aria-pressed="${record.documentId === state.activeDocument}"><b>${esc(lessonName(record))}</b><span class="small">客观 ${esc(textScore(record.objectiveScore, 80))} · ${isGraded(record) ? '已批改' : '待批改'}</span><small>${esc(displayDate(record.submittedAt))}</small><small>版本 ${esc(record.version || '未记录')}${group.latest.get(lessonId(record))?.documentId === record.documentId ? ' · 本课最新' : ''}</small></button>`).join('');
    byId('attemptHistory').querySelectorAll('[data-attempt-index]').forEach(button => button.addEventListener('click', () => {
      if (state.saving) return;
      const record = group.records[Number(button.dataset.attemptIndex)];
      state.activeDocument = record.documentId;
      renderHistory(group);
      renderAttempt(record);
    }));
  }

  function answerText(index, options) {
    if (!Number.isInteger(index) || index < 0) return '未作答 / 未记录';
    const option = Array.isArray(options) ? options[index] : undefined;
    return `${String.fromCharCode(65 + index)}${option === undefined ? '' : `．${option}`}`;
  }

  function durationText(seconds) {
    if (number(seconds) === null || seconds < 0) return '未记录';
    return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
  }

  function renderAttempt(record) {
    const snapshot = record.questionSnapshot || {};
    const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
    const results = new Map((Array.isArray(record.results) ? record.results : []).map(result => [String(result.questionId), result]));
    const dimensions = Object.entries(record.dimensionScores || {}).map(([dimension, value]) => `<span class="dimension">${esc(DIMENSIONS[dimension] || dimension)} ${esc(textScore(value?.score, value?.max ?? '—'))}</span>`).join('');
    const answers = questions.map((question, index) => {
      const result = results.get(String(question.id));
      const selected = result?.selected ?? record.answers?.[question.id];
      const answer = result?.answer ?? question.answer;
      const correct = result?.correct === true;
      const options = Array.isArray(question.options) ? question.options : [];
      return `<article class="answer-card"><div class="answer-heading"><h4>${index + 1}. ${esc(question.prompt || question.id)}</h4><span class="answer-result${correct ? '' : ' wrong'}">${result ? correct ? '正确' : '错误' : '无评分记录'}${number(result?.points) === null ? '' : ` · ${result.points}分`}</span></div><ol class="answer-options" type="A">${options.map(option => `<li>${esc(option)}</li>`).join('')}</ol><p class="answer-info">学生选择：${esc(answerText(selected, options))}</p><p class="answer-info">参考答案：${esc(answerText(answer, options))}</p><p class="answer-explanation">${esc(result?.explanation || question.explanation || '')}</p>${question.source ? `<p class="source-note">来源：${esc(sourceText(question.source))}</p>` : ''}</article>`;
    }).join('');
    const writing = typeof record.writing === 'string' ? record.writing : '';
    const passage = typeof snapshot.passage === 'string' ? snapshot.passage : snapshot.passage?.text;
    byId('attemptDetail').innerHTML = `<section class="attempt-banner"><h3>${esc(lessonName(record))}</h3><div class="attempt-meta"><span>客观题 <strong>${esc(textScore(record.objectiveScore, 80))}</strong></span><span>短表达 <strong>${isGraded(record) ? esc(textScore(record.writingScore, 20)) : '待批改'}</strong></span><span>总分 <strong>${isGraded(record) ? esc(textScore(record.totalScore, 100)) : '待短表达评分'}</strong></span></div><div class="attempt-meta small muted"><span>${esc(displayDate(record.submittedAt))}</span><span>用时 ${esc(durationText(record.durationSeconds))}</span><span>版本 ${esc(record.version || '未记录')}</span></div><div class="dimensions">${dimensions}</div></section><section><h3>客观题作答明细</h3>${passage ? `<p class="small muted">本卷阅读材料</p><div class="passage">${esc(passage)}</div>` : ''}${answers || '<p class="empty">这份记录没有完整的试题快照，无法还原题目。</p>'}</section><section class="writing-section"><h3>短表达原文</h3><p class="writing-prompt">${esc(snapshot.writing?.prompt || '请结合本课写作要求评分。')}</p><div class="writing-text">${esc(writing || '学生未填写短表达。')}</div>${snapshot.writing?.source ? `<p class="source-note">来源：${esc(sourceText(snapshot.writing.source))}</p>` : ''}<p class="grade-metadata">${record.grade?.gradedAt ? `上次批改：${esc(displayDate(record.grade.gradedAt))}` : '尚未批改'} · 评分版本 ${esc(record.gradeRevision ?? 0)}</p></section>`;
    ['content', 'grammar', 'expression'].forEach(key => { byId(`${key}Score`).value = number(record.grade?.scores?.[key]) === null ? '' : record.grade.scores[key]; });
    byId('gradeFeedback').value = typeof record.grade?.feedback === 'string' ? record.grade.feedback : '';
    byId('saveGrade').textContent = isGraded(record) ? '更新批改到云端' : '保存批改到云端';
    byId('saveGrade').disabled = false;
    setMessage('gradeMessage', '');
    updateGradeTotal();
  }

  function getGradeScores() {
    const scores = {};
    for (const [key, max] of [['content', 8], ['grammar', 8], ['expression', 4]]) {
      const raw = byId(`${key}Score`).value;
      const value = Number(raw);
      if (raw === '' || !Number.isInteger(value) || value < 0 || value > max) return null;
      scores[key] = value;
    }
    return scores;
  }

  function updateGradeTotal() {
    const scores = getGradeScores();
    byId('gradeTotal').textContent = scores ? `短表达合计 ${scores.content + scores.grammar + scores.expression} / 20` : '请按范围填写三个整数分数。';
  }

  async function saveGrade(event) {
    event.preventDefault();
    if (state.saving) return;
    const record = state.records.find(item => item.documentId === state.activeDocument);
    const scores = getGradeScores();
    if (!record || !state.password) return;
    if (!scores) { setMessage('gradeMessage', '请填写合法的分数：内容0—8，目标句型0—8，表达0—4。', 'error'); return; }
    const epoch = state.epoch;
    const documentId = record.documentId;
    const feedback = byId('gradeFeedback').value.trim();
    state.saving = true;
    byId('saveGrade').disabled = true;
    byId('saveGrade').textContent = '正在保存……';
    ['contentScore', 'grammarScore', 'expressionScore', 'gradeFeedback'].forEach(id => { byId(id).disabled = true; });
    byId('attemptHistory').querySelectorAll('button').forEach(button => { button.disabled = true; });
    setMessage('gradeMessage', '正在保存到云端……');
    try {
      const result = await callApi({ action: 'stageGrade', teacherPassword: state.password, documentId, scores, feedback, expectedRevision: record.gradeRevision ?? 0 });
      if (epoch !== state.epoch) return;
      if (!result.attempt || result.attempt.documentId !== documentId || !isGraded(result.attempt)) throw new Error('云端没有返回完整的批改确认，请重新读取记录核对是否保存。');
      const index = state.records.findIndex(item => item.documentId === documentId);
      state.records[index] = result.attempt;
      rebuildGroups();
      renderDashboard();
      state.saving = false;
      openStudent(state.groups.find(group => group.key === state.activeStudent), documentId);
      setMessage('gradeMessage', '批改已保存到云端。', 'success');
      byId('syncMessage').textContent = `批改已同步 · ${new Date().toLocaleString('zh-CN', { hour12: false })} · 共 ${state.records.length} 份记录`;
    } catch (error) {
      if (epoch === state.epoch) endSession(`${error.message} 本页已清除当前查看结果，请重新登录后核对云端记录。`, 'error');
    } finally {
      if (epoch === state.epoch) {
        state.saving = false;
        byId('saveGrade').disabled = false;
        ['contentScore', 'grammarScore', 'expressionScore', 'gradeFeedback'].forEach(id => { byId(id).disabled = false; });
        byId('attemptHistory').querySelectorAll('button').forEach(button => { button.disabled = false; });
      }
    }
  }

  function csvCell(value) {
    let text = String(value ?? '');
    // Quoting alone does not stop spreadsheet formula execution.
    if (/^[\s\u0000-\u0020\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!state.password || !state.records.length) return;
    const latestOnly = byId('exportScope').value === 'latest';
    const records = scopedRecords(matchingGroups(), latestOnly).sort(newestFirst);
    if (!records.length) return;
    const headers = ['班级（自报）', '姓名（自报）', '学号（自报）', '课次', '课名', '试卷版本', '客观分（满分80）', '词语分', '语法分', '阅读分', '批改状态', '短表达分（满分20）', '总分（满分100）', '内容分（满分8）', '目标句型分（满分8）', '表达分（满分4）', '短表达原文', '教师反馈', '提交时间', '作答秒数', '批改时间', '评分版本', '历次提交标识', '云端记录标识', '作答明细'];
    const rows = records.map(record => [
      record.student?.className, record.student?.name,
      record.student?.studentNumber ? `'${record.student.studentNumber}` : '',
      lessonId(record), record.lessonTitle || LESSONS[lessonId(record)], record.version,
      record.objectiveScore, record.dimensionScores?.vocabulary?.score, record.dimensionScores?.grammar?.score, record.dimensionScores?.reading?.score,
      isGraded(record) ? '已批改' : '待批改', record.writingScore, record.totalScore,
      record.grade?.scores?.content, record.grade?.scores?.grammar, record.grade?.scores?.expression,
      record.writing, record.grade?.feedback, record.submittedAt, record.durationSeconds, record.grade?.gradedAt,
      record.gradeRevision ?? 0, record.attemptId, record.documentId, JSON.stringify(record.results || [])
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `阶段测试-${latestOnly ? '最新提交' : '历次提交'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    byId('syncMessage').textContent = `已导出当前筛选的 ${records.length} 份${latestOnly ? '最新' : '历次'}提交。学号按文本导出。`;
  }

  byId('loginForm').addEventListener('submit', event => {
    event.preventDefault();
    if (state.loading) return;
    state.password = byId('teacherPassword').value;
    if (!state.password) return;
    loadAllRecords();
  });
  byId('cancelLoad').addEventListener('click', () => endSession('已取消读取。'));
  byId('logoutButton').addEventListener('click', () => endSession('已退出；本页内存中的密码和学生记录已清除。'));
  byId('refreshButton').addEventListener('click', () => { if (!state.saving) loadAllRecords(); });
  byId('searchInput').addEventListener('input', renderDashboard);
  byId('classFilter').addEventListener('change', renderDashboard);
  byId('lessonFilter').addEventListener('change', renderDashboard);
  byId('clearFilters').addEventListener('click', () => {
    byId('searchInput').value = '';
    byId('classFilter').value = '';
    byId('lessonFilter').value = '';
    renderDashboard();
  });
  byId('exportButton').addEventListener('click', exportCsv);
  byId('closeDetail').addEventListener('click', () => { if (!state.saving) byId('detailDialog').close(); });
  byId('detailDialog').addEventListener('cancel', event => { if (state.saving) event.preventDefault(); });
  byId('gradeForm').addEventListener('submit', saveGrade);
  ['contentScore', 'grammarScore', 'expressionScore'].forEach(id => byId(id).addEventListener('input', updateGradeTotal));
  window.addEventListener('pagehide', () => endSession());
})();
