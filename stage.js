/* Student page: public questions only; grading and storage are performed by the cloud API. */
'use strict';
(() => {
  const API='https://cloudbase-d3gxxe4l88c3d5907-1431364187.ap-shanghai.app.tcloudbase.com/ecrl/lesson8';
  const KEY='ecrl_stage_session_v1';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={vocabulary:'词语',grammar:'语言点',reading:'阅读理解'};
  const lessonPoints={'8':'人物、往事与比较句','9':'让／叫、表达心情与比较','10':'快乐的原因与逐渐变化','11':'故事变化与疑问词用法','12':'语言误会、把字句与反问'};
  let data={student:null,drafts:{},receipts:{}},bank=null,lesson=null,draft=null,current=0,pending=null,receipt=null,busy=false,clock,view='home';
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const validStudent=s=>object(s)&&['name','studentNumber','className'].every(k=>typeof s[k]==='string'&&s[k].trim()&&[...s[k]].length<=80&&!/[\p{Cc}\p{Cf}]/u.test(s[k]));
  const writingLength=value=>[...String(value??'').replace(/\s/gu,'')].length;
  try { const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');if(object(saved?.drafts)&&object(saved?.receipts))data={student:validStudent(saved.student)?saved.student:null,drafts:saved.drafts,receipts:saved.receipts}; } catch {}
  function save(){try{sessionStorage.setItem(KEY,JSON.stringify(data));}catch{$('storageWarning').classList.remove('hidden');}}
  function studentKey(s){return JSON.stringify([s.className,s.studentNumber]);}
  function draftKey(id,student=data.student){return studentKey(student)+':'+id;}
  const normalize=s=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
  function show(id){view=id;['home','quiz','result'].forEach(x=>$(x).classList.toggle('hidden',x!==id));window.scrollTo(0,0);}
  function clearActive(){clearInterval(clock);lesson=null;draft=null;pending=null;receipt=null;current=0;$('questionBody').innerHTML='';$('questionNav').innerHTML='';$('answerReview').innerHTML='';$('resultScore').innerHTML='';$('resultMessage').textContent='';$('quizIdentity').textContent='';}
  async function request(body){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);try{const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});let j;try{j=await r.json();}catch{throw Error('云端未返回有效结果，请稍后重试。');}if(!r.ok||!j.ok)throw Error(j.message||'云端暂时无法处理，请稍后重试。');return j;}catch(e){if(e.name==='AbortError')throw Error('网络响应较慢，尚未确认上传。请保持页面并重试。');if(e instanceof TypeError)throw Error('暂时无法连接云端，请检查网络后重试。');throw e;}finally{clearTimeout(timer);}}
  function renderIdentity(){const s=data.student;$('identityForm').classList.toggle('hidden',!!s);$('identitySummary').classList.toggle('hidden',!s);if(s){$('identitySummary').innerHTML=`<h3>${esc(s.name)}</h3><p>${esc(s.className)} · ${esc(s.studentNumber)}</p><p class="privacy">请核对班级和学号后开始。同一班级＋学号的历次提交归为一人。</p><button id="editIdentity" class="text-button" type="button">修改信息</button>`;$('editIdentity').onclick=()=>{if(view!=='home'||busy)return;['name','studentNumber','className'].forEach(k=>$(k).value=s[k]);clearActive();data.student=null;save();renderIdentity();renderCards();$('name').focus();};}else $('identitySummary').innerHTML='';}
  function renderCards(){if(!bank)return;$('lessonCards').innerHTML=bank.lessons.map(l=>{const old=data.student?data.drafts[draftKey(l.id)]:null;const r=data.student?data.receipts[draftKey(l.id)]:null;const status=old?.pending?'有一份作答等待确认上传':old?'本标签页有未完成草稿':r?`本次已提交 · 客观题 ${r.objectiveScore}/80`:'10道选择题＋1段短表达';return `<article class="lesson-card"><div class="lesson-top"><div class="lesson-number">${l.id.padStart(2,'0')}</div><h3>${esc(l.title)}</h3></div><div class="lesson-bottom"><p>${lessonPoints[l.id]}</p><div class="lesson-status">${esc(status)}</div><button class="primary" type="button" data-lesson="${l.id}" ${data.student?'':'disabled'}>${old?'继续本次测验':r?'再练一次':'开始测验'} →</button></div></article>`;}).join('');document.querySelectorAll('[data-lesson]').forEach(b=>b.onclick=()=>start(b.dataset.lesson));}
  function validCatalog(value){
    if(!object(value)||typeof value.version!=='string'||!value.version||!Array.isArray(value.lessons)||!value.lessons.length)return false;
    const ids=new Set();return value.lessons.every(l=>{
      if(!object(l)||typeof l.id!=='string'||!Object.hasOwn(lessonPoints,l.id)||ids.has(l.id)||typeof l.title!=='string'||!l.title.trim()||!Array.isArray(l.questions)||l.questions.length!==10||!object(l.writing)||typeof l.writing.prompt!=='string')return false;
      ids.add(l.id);const questionIds=new Set();return l.questions.every(q=>{
        if(!object(q)||typeof q.id!=='string'||!q.id.startsWith(l.id+'-')||questionIds.has(q.id)||!Object.hasOwn(names,q.dimension)||typeof q.prompt!=='string'||!Array.isArray(q.options)||q.options.length!==4||!q.options.every(option=>typeof option==='string'))return false;
        questionIds.add(q.id);return true;
      });
    });
  }
  async function load(){const notice=$('loadState');notice.classList.remove('hidden');notice.textContent='正在连接测验题库……';try{const catalog=await request({action:'stageCatalog'});if(!validCatalog(catalog))throw Error('题库暂未准备好，请联系老师。');bank={...catalog,lessons:[...catalog.lessons].sort((a,b)=>Number(a.id)-Number(b.id))};notice.classList.add('hidden');renderCards();}catch(e){notice.innerHTML=`${esc(e.message)} <button class="text-button" id="reloadBank" type="button">重新连接</button>`;$('reloadBank').onclick=load;}}
  function start(id){
    if(view!=='home'||busy||!bank||!data.student)return;
    const selectedLesson=bank.lessons.find(l=>l.id===id);if(!selectedLesson)return;
    const key=draftKey(id);let saved=data.drafts[key];
    if(saved?.version!==bank.version&&!saved?.pending){if(saved&&!confirm('题目已更新，需要重新开始本课测验。旧草稿不会上传，确定继续吗？'))return;saved=null;}
    if(!object(saved)||typeof saved.attemptId!=='string')saved={attemptId:crypto.randomUUID(),version:bank.version,answers:{},writing:'',startedAt:Date.now(),current:0};
    if(!object(saved.answers))saved.answers={};if(typeof saved.writing!=='string')saved.writing='';
    if(!Number.isFinite(saved.startedAt))saved.startedAt=Date.now();
    if(!saved.snapshot&&saved.version===bank.version)saved.snapshot=JSON.parse(JSON.stringify(selectedLesson));
    lesson=selectedLesson;draft=saved;data.drafts[key]=draft;
    current=Number.isInteger(draft.current)?Math.min(lesson.questions.length,Math.max(0,draft.current)):0;save();
    if(draft.pending){pending=draft.pending;receipt=null;renderPending('这份作答尚未确认上传，请点击重新上传。');return;}
    pending=null;receipt=null;$('quizIdentity').textContent=`${data.student.name} · ${data.student.className} · ${data.student.studentNumber}`;$('quizLesson').textContent=`第${lesson.id}课 / 阶段测验`;$('quizTitle').textContent=lesson.title;show('quiz');renderQuestion();clearInterval(clock);clock=setInterval(updateTime,1000);updateTime();
  }
  function elapsedSeconds(){return draft&&Number.isFinite(draft.startedAt)?Math.min(86400,Math.max(0,Math.floor((Date.now()-draft.startedAt)/1000))):0;}
  function updateTime(){if(!draft||view!=='quiz')return;const sec=elapsedSeconds();$('elapsed').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
  function hasAnswer(q){const value=draft.answers[q.id];return Number.isInteger(value)&&value>=0&&value<q.options.length;}
  function completeCount(){return lesson.questions.filter(hasAnswer).length+(writingLength(draft.writing)>=15?1:0);}
  function nav(){const total=lesson.questions.length,n=total+1;$('questionNav').innerHTML=Array.from({length:n},(_,i)=>{const answered=i<total?hasAnswer(lesson.questions[i]):writingLength(draft.writing)>=15;return `<button type="button" data-q="${i}" class="${current===i?'current ':''}${answered?'answered':''}" aria-label="${i===total?'短表达':'第'+(i+1)+'题'}${answered?'，已作答':''}" ${current===i?'aria-current="step"':''}>${i+1}</button>`;}).join('');document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{if(view!=='quiz'||busy)return;current=Number(b.dataset.q);renderQuestion();});$('completion').textContent=`已完成 ${completeCount()} / ${n}`;$('prevQuestion').disabled=current===0;$('nextQuestion').classList.toggle('hidden',current===total);$('submitQuiz').classList.toggle('hidden',current!==total);}
  function renderQuestion(){draft.current=current;save();nav();$('quizError').textContent='';const q=lesson.questions[current];const box=$('questionBody');if(q){box.innerHTML=`<span class="step-label">${current+1} / 11 · ${names[q.dimension]} · 8分</span>${q.usePassage?`<div class="reading"><small>${esc(lesson.passageSource||'根据教材阅读练习缩写')}</small><p>${esc(lesson.passage)}</p></div>`:''}<fieldset><legend tabindex="-1">${esc(q.prompt)}</legend><div class="options">${q.options.map((o,i)=>`<label class="option"><input type="radio" name="answer" value="${i}" ${draft.answers[q.id]===i?'checked':''}><span><b>${'ABCD'[i]}</b>${esc(o)}</span></label>`).join('')}</div></fieldset><p class="source-note" style="margin:18px 0 0">${esc(q.source)}</p>`;box.querySelectorAll('input').forEach(input=>input.onchange=()=>{draft.answers[q.id]=Number(input.value);save();nav();});}else{box.innerHTML=`<span class="step-label">11 / 11 · 短表达 · 20分（老师批改）</span><h2 style="margin-top:15px">用自己的话写一小段</h2><p class="write-prompt" id="writingPrompt">${esc(lesson.writing.prompt)}</p><label for="writing">我的短表达</label><textarea id="writing" rows="6" maxlength="300" aria-describedby="writingPrompt">${esc(draft.writing)}</textarea><div class="write-meta"><span>建议30—50字；至少15字才能提交</span><span id="charCount"></span></div><p class="source-note" style="margin-top:18px">${esc(lesson.writing.source)}</p><p class="footnote">评分：内容8分＋本课句型8分＋表达清楚4分。范文不是唯一答案。</p>`;$('writing').oninput=()=>{draft.writing=$('writing').value;save();count();nav();};count();}window.scrollTo(0,0);}
  function count(){$('charCount').textContent=`${writingLength(draft.writing)} 字符（含标点）`;}
  function renderPending(message){clearInterval(clock);show('result');$('resultBadge').textContent='等待云端确认';$('resultTitle').textContent='作答已保留在本标签页';const s=pending?.student;$('resultMessage').textContent=(s?`${s.name} · ${s.className} · 学号 ${s.studentNumber}。`:'')+message+' 未显示“云端已收到”之前，请不要关闭或清除草稿。';$('resultScore').innerHTML='';$('answerReview').innerHTML='';$('retryUpload').classList.remove('hidden');$('resultTitle').focus();}
  function validReceipt(value,submission){
    if(!object(value)||value.attemptId!==submission.attemptId||value.lessonId!==submission.lessonId||value.version!==submission.version||!validStudent(value.student)||studentKey(value.student)!==studentKey(submission.student)||!Number.isFinite(value.objectiveScore)||value.objectiveScore<0||value.objectiveScore>80||!Number.isInteger(value.durationSeconds)||value.durationSeconds<0||value.durationSeconds>86400||!Array.isArray(value.results)||value.results.length!==10||typeof value.writing!=='string')return false;
    const ids=new Set();return value.results.every(result=>{if(!object(result)||typeof result.questionId!=='string'||ids.has(result.questionId)||!Object.hasOwn(submission.answers,result.questionId)||result.selected!==submission.answers[result.questionId]||!Number.isInteger(result.answer)||result.answer<0||typeof result.correct!=='boolean'||typeof result.explanation!=='string')return false;ids.add(result.questionId);return true;});
  }
  async function upload(){
    if(view!=='result'||busy||!pending)return;
    const submission=pending,key=draftKey(submission.lessonId,submission.student);busy=true;$('retryUpload').disabled=true;$('retryUpload').textContent='正在确认上传……';$('resultHome').disabled=true;
    try{const result=await request(submission);if(!validReceipt(result.attempt,submission))throw Error('云端回执不完整，作答仍已保留，请重试确认。');receipt=result.attempt;data.receipts[key]=receipt;delete data.drafts[key];save();pending=null;renderResult();}
    catch(e){renderPending(e.message);}finally{busy=false;$('retryUpload').disabled=false;$('retryUpload').textContent='重新上传';$('resultHome').disabled=false;}
  }
  function renderResult(){
    clearInterval(clock);show('result');$('retryUpload').classList.add('hidden');$('resultBadge').textContent='云端已收到 ✓';$('resultTitle').textContent=`第${receipt.lessonId}课，已完成！`;$('resultMessage').textContent=`${receipt.student.name} · ${receipt.student.className} · 学号 ${receipt.student.studentNumber}。老师已能查看本次作答；短表达待老师批改。`;
    $('resultScore').innerHTML=`<div class="score-grid"><div class="score-tile"><span>客观题成绩</span><strong>${esc(receipt.objectiveScore)}<small>/80</small></strong></div><div class="score-tile"><span>短表达 / 20分</span><strong style="font-size:21px">待批改</strong></div><div class="score-tile"><span>本次用时</span><strong style="font-size:21px">${Math.floor(receipt.durationSeconds/60)}分${receipt.durationSeconds%60}秒</strong></div></div><p class="footnote">提交时间：${esc(new Date(receipt.submittedAt).toLocaleString('zh-CN'))} · 回执：${esc(receipt.attemptId)}</p>`;
    const snapshot=draft?.snapshot||(receipt.version===bank?.version?lesson:null);
    const review=Array.isArray(snapshot?.questions)?receipt.results.map(r=>{const q=snapshot.questions.find(x=>x?.id===r.questionId);if(!q||!Array.isArray(q.options))return '';return `<article class="review-item ${r.correct?'correct':'incorrect'}"><span class="review-tag">${r.correct?'答对了 · 8分':'再巩固一下 · 0分'}</span><h3>${esc(q.prompt)}</h3><p>我的选择：${esc(q.options[r.selected])}<br>参考答案：${esc(q.options[r.answer])}</p><p>${esc(r.explanation)}</p><small class="muted">${esc(q.source)}</small></article>`;}).join(''):'<p class="notice">本次提交来自较早版本，成绩已保存。旧试题详情请老师在教师端查看。</p>';
    $('answerReview').innerHTML=`<h2 style="margin-top:28px">看看哪些已经会了</h2>${review}<article class="review-item"><h3>我的短表达 · 待老师批改</h3><p>${esc(receipt.writing)}</p></article>`;$('resultTitle').focus();
  }
  $('identityForm').onsubmit=e=>{e.preventDefault();if(view!=='home'||busy)return;const s={name:normalize($('name').value),studentNumber:normalize($('studentNumber').value).toUpperCase(),className:normalize($('className').value)};if(!validStudent(s)){$('identityError').textContent='请完整填写姓名、学号和班级，不要仅输入空格或不可见字符。';return;}$('identityError').textContent='';clearActive();data.student=s;save();renderIdentity();renderCards();};
  $('prevQuestion').onclick=()=>{if(view==='quiz'&&!busy&&current>0){current--;renderQuestion();}};$('nextQuestion').onclick=()=>{if(view==='quiz'&&!busy&&current<lesson.questions.length){current++;renderQuestion();}};
  $('questionForm').onsubmit=e=>{
    e.preventDefault();if(view!=='quiz'||busy||!lesson||!draft||!data.student)return;
    const missing=lesson.questions.findIndex(q=>!hasAnswer(q));if(missing>=0){current=missing;renderQuestion();$('quizError').textContent='还有题目没有完成，请先选择答案。';return;}
    const writing=draft.writing.trim();
    if(writingLength(writing)<15||[...writing].length>300||/[\p{Cc}\p{Cf}]/u.test(writing.replace(/[\r\n\t]/g,''))){current=lesson.questions.length;renderQuestion();$('quizError').textContent='请完成短表达：至少15字，建议30—50字，最多300字；不要使用不可见字符。';$('writing').focus();return;}
    if(current!==lesson.questions.length){current=lesson.questions.length;renderQuestion();$('quizError').textContent='请核对短表达后，点击“检查并提交”。';return;}
    pending={action:'stageSubmit',attemptId:draft.attemptId,lessonId:lesson.id,version:draft.version,student:{...data.student},answers:Object.fromEntries(lesson.questions.map(q=>[q.id,draft.answers[q.id]])),writing,durationSeconds:elapsedSeconds()};draft.pending=pending;save();renderPending('正在上传本次作答。');upload();
  };
  function home(){if(busy)return;clearInterval(clock);show('home');renderCards();}
  $('backHome').onclick=home;$('resultHome').onclick=home;$('retryUpload').onclick=upload;
  $('clearDevice').onclick=()=>{if(view!=='home'||busy)return;if(confirm('清除本标签页的姓名和未提交草稿？已经上传的云端记录不会删除。')){clearActive();data={student:null,drafts:{},receipts:{}};['name','studentNumber','className'].forEach(k=>$(k).value='');$('identityError').textContent='';save();renderIdentity();renderCards();}};
  $('downloadRecord').onclick=()=>{if(view!=='result')return;const record=receipt||pending;if(!record)return;const blob=new Blob([JSON.stringify({status:receipt?'cloud-confirmed':'not-confirmed',record},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`第${record.lessonId}课-本次作答-${record.attemptId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
  renderIdentity();load();
})();
