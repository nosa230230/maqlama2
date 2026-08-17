/* ===================================================================
 * مَقْلَمَة - منصة تعليمية
 * Supabase-first: Auth + Database + Storage + Realtime
 * يحتفظ بنفس التصميم — يطوّر الوظائف فقط.
 * =================================================================== */

/* ============== Config ============== */
const ENV = window.MAQLAMA_ENV || {};
const SUPABASE_URL = ENV.SUPABASE_URL;
const SUPABASE_KEY = ENV.SUPABASE_KEY;
const BUCKET       = ENV.STORAGE_BUCKET || 'maqlama';
const AUTH_DOMAIN  = ENV.AUTH_DOMAIN || 'maqlama.local';
const CACHE_KEY    = 'maqlama_cache_v2';

let sb = null;
try {
  if (window.supabase && SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR-PROJECT')) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'maqlama_auth' },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }
} catch (e) { console.error('Supabase init failed', e); }

function requireSb(){ if(!sb){ toast('Supabase غير مفعّل','عدّل env.js','error'); throw new Error('no supabase'); } return sb; }

/* ============== Helpers ============== */
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const fmtDate = t => new Date(t).toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' });
const fmtTime = t => {
  const diff = Date.now() - new Date(t).getTime();
  if (diff < 60000) return 'الآن';
  if (diff < 3600000) return Math.floor(diff/60000)+' د';
  if (diff < 86400000) return Math.floor(diff/3600000)+' س';
  return fmtDate(t);
};
const escapeHtml = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usernameToEmail = u => u.includes('@') ? u : `${u.toLowerCase().replace(/[^a-z0-9_.]/g,'')}@${AUTH_DOMAIN}`;

function toast(title, body='', type='info') {
  const icons = { info:'fa-circle-info', success:'fa-circle-check', error:'fa-circle-exclamation', warning:'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="ic"><i class="fas ${icons[type]}"></i></div><div><strong>${escapeHtml(title)}</strong>${body?`<small>${escapeHtml(body)}</small>`:''}</div>`;
  $('#toastContainer').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='.3s'; setTimeout(()=>el.remove(),300); }, 3500);
}

function modal({ title, body, footer='', wide=false }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" data-overlay>
      <div class="modal ${wide?'wide':''}">
        <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="icon-btn" data-close><i class="fas fa-xmark"></i></button></div>
        <div class="modal-body">${body}</div>
        ${footer?`<div class="modal-foot">${footer}</div>`:''}
      </div>
    </div>`;
  const close = ()=> root.innerHTML='';
  root.querySelector('[data-overlay]').addEventListener('click', e=>{ if(e.target.hasAttribute('data-overlay')) close(); });
root.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', close);
});
  return { close, root };
}

/* ============== App State ============== */
const State = {
  user: null,           // profiles row { id, username, name, role, ... }
  session: null,        // supabase session
  view: 'dashboard',
  currentRoom: 'r_general',
  rooms: [],
  messagesByRoom: {},
  courses: [],
  lessons: [],          // flat list
  paths: [],
  enrollments: [],      // for current user (or all if admin)
  pathEnrollments: [],
  profiles: [],         // all users (admin uses; students use it for chat avatars)
  notifications: [],
  liveStream: null,
  settings: { theme: localStorage.getItem('maqlama_theme') || 'light' },
};

/* small cache to speed reloads (UI only) */
function cacheSave(){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify({
  courses: State.courses, paths: State.paths, rooms: State.rooms, profiles: State.profiles
})); }catch{} }
function cacheLoad(){ try{ const r = JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); if(r){ Object.assign(State, r); } }catch{} }

/* ============== Auth ============== */
async function ensureDefaultAdmin() {
  // Admin accounts are created securely from Supabase Authentication.
  // Never auto-sign-up an account with role=admin from the browser.
  return null;
}

async function signIn(usernameOrEmail, password) {
  let email = usernameOrEmail.trim();
  if (!email.includes('@')) {
    const { data: profile, error: lookupError } = await sb
      .from('profiles').select('email').eq('username', email).maybeSingle();
    if (lookupError) throw lookupError;
    if (!profile?.email) throw new Error('اسم المستخدم غير موجود');
    email = profile.email;
  }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  try { await sb.auth.signOut(); } catch{}
  State.user = null; State.session = null;
  unsubscribeAll();
  $('#appShell').classList.add('hidden');
  $('#loginPage').classList.remove('hidden');
  toast('تم تسجيل الخروج','','info');
}

async function loadProfile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}

function initLogin() {
  $$('.login-tab').forEach(t => t.addEventListener('click', () => {
    $$('.login-tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const isAdmin = t.dataset.tab === 'admin';
    const adm = ENV.DEFAULT_ADMIN || {};
    $('#loginUser').value = isAdmin ? (adm.username||'admin') : '';
    $('#loginPass').value = isAdmin ? (adm.password||'admin1234') : '';
  }));
  $$('.show-pass').forEach(b => b.addEventListener('click', () => {
    const input = $('#'+b.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    b.querySelector('i').className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
  }));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) { toast('Supabase غير مفعّل','يجب تعديل env.js','error'); return; }
    const u = $('#loginUser').value.trim();
    const p = $('#loginPass').value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; const oldHtml = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ الدخول...';
    try {
      await signIn(u, p);
      toast('أهلاً بك','تم الدخول بنجاح','success');
      await afterLogin();
    } catch(err) {
      console.error(err);
      toast('فشل الدخول', err.message || 'بيانات غير صحيحة', 'error');
    } finally { btn.disabled = false; btn.innerHTML = oldHtml; }
  });
}

async function afterLogin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  State.session = session;
  State.user = await loadProfile(session.user.id);
  if (!State.user) { toast('خطأ','الملف الشخصي غير موجود','error'); await signOut(); return; }
  $('#loginPage').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#userName').textContent = State.user.name;
  $('#userRole').textContent = State.user.role === 'admin' ? 'مدير' : 'طالب';
  $('#userAvatar').textContent = State.user.avatar || State.user.name[0];
  $$('.admin-only').forEach(el => el.style.display = State.user.role === 'admin' ? '' : 'none');
  applyTheme();
  await Promise.all([
    loadRooms(), loadCourses(), loadPaths(), loadProfiles(),
    loadEnrollments(), loadNotifications(), loadActiveLive()
  ]);
  subscribeGlobal();
  await setOnline(true);
  navigate('dashboard');
}

/* ============== Data loaders ============== */
async function loadRooms() {
  const { data } = await sb.from('chat_rooms').select('*').order('created_at');
  State.rooms = data || [];
}
async function loadCourses() {
  const { data } = await sb.from('courses').select('*').order('created_at',{ascending:false});
  State.courses = data || [];
  const { data: lessons } = await sb.from('lessons').select('*').order('position').order('created_at');
  State.lessons = lessons || [];
  cacheSave();
}
async function loadPaths() {
  const { data } = await sb.from('learning_paths').select('*').order('created_at',{ascending:false});
  State.paths = data || [];
}
async function loadProfiles() {
  const { data } = await sb.from('profiles').select('*').order('joined_at',{ascending:false});
  State.profiles = data || [];
}
async function loadEnrollments() {
  const isAdmin = State.user.role === 'admin';
  const q1 = sb.from('enrollments').select('*');
  const q2 = sb.from('path_enrollments').select('*');
  const [{ data: e1 }, { data: e2 }] = await Promise.all([
    isAdmin ? q1 : q1.eq('user_id', State.user.id),
    isAdmin ? q2 : q2.eq('user_id', State.user.id),
  ]);
  State.enrollments = e1 || [];
  State.pathEnrollments = e2 || [];
}
async function loadNotifications() {
  try {
    const [{ data: notifications, error: notificationsError }, { data: dismissals, error: dismissalsError }] =
      await Promise.all([
        sb.from('notifications')
          .select('*')
          .or(`user_id.is.null,user_id.eq.${State.user.id}`)
          .order('created_at', { ascending: false })
          .limit(50),

        sb.from('notification_dismissals')
          .select('notification_id')
          .eq('user_id', State.user.id)
      ]);

    if (notificationsError) {
      console.error('خطأ تحميل الإشعارات:', notificationsError);
      State.notifications = [];
      renderNotifications();
      return;
    }

    if (dismissalsError) {
      console.error('خطأ تحميل الإشعارات المخفية:', dismissalsError);
      State.notifications = notifications || [];
      renderNotifications();
      return;
    }

    const dismissedIds = new Set(
      (dismissals || []).map(item => item.notification_id)
    );

    State.notifications = (notifications || []).filter(
      notification => !dismissedIds.has(notification.id)
    );

    renderNotifications();

  } catch (error) {
    console.error('Notifications error:', error);
    State.notifications = [];
    renderNotifications();
  }
}
async function loadActiveLive() {
  const { data } = await sb.from('live_streams').select('*').eq('active', true)
    .order('started_at',{ascending:false}).limit(1).maybeSingle();
  State.liveStream = data || null;
  $('#liveDot').style.display = State.liveStream ? 'inline-block' : 'none';
}

/* ============== Realtime ============== */
let channels = [];
function unsubscribeAll(){ channels.forEach(c => { try{ sb.removeChannel(c); }catch{} }); channels = []; }

function subscribeGlobal() {
  unsubscribeAll();
  // notifications
  channels.push(sb.channel('rt:notifications')
    .on('postgres_changes', { event:'*', schema:'public', table:'notifications' }, async () => { await loadNotifications(); })
    .subscribe());
  // courses & lessons
  channels.push(sb.channel('rt:courses')
    .on('postgres_changes', { event:'*', schema:'public', table:'courses' }, async () => { await loadCourses(); if(['courses','dashboard','manageCourses'].includes(State.view)) refresh(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'lessons' }, async () => { await loadCourses(); if(['courses','dashboard','manageCourses'].includes(State.view)) refresh(); })
    .subscribe());
  // live streams
  channels.push(sb.channel('rt:live')
    .on('postgres_changes', { event:'*', schema:'public', table:'live_streams' }, async () => { await loadActiveLive(); if(State.view==='live') renderLive(); })
    .subscribe());
  // profiles (online status)
  channels.push(sb.channel('rt:profiles')
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'profiles' }, async (p) => {
      const i = State.profiles.findIndex(x=>x.id===p.new.id);
      if (i>=0) State.profiles[i] = p.new;
      if (State.view==='chat') renderChatMessages();
      if (State.view==='students') renderStudents();
    })
    .subscribe());
}

let roomChannel = null;
function subscribeRoom() {
  if (roomChannel) { try{ sb.removeChannel(roomChannel); }catch{} roomChannel = null; }
  const rid = State.currentRoom;
  roomChannel = sb.channel('room:'+rid)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`room_id=eq.${rid}` }, (p) => {
      const arr = State.messagesByRoom[rid] || (State.messagesByRoom[rid]=[]);
      if (arr.some(m=>m.id===p.new.id)) return;
      arr.push(p.new);
      if (State.view==='chat') renderChatMessages();
    })
    .on('postgres_changes', { event:'DELETE', schema:'public', table:'chat_messages', filter:`room_id=eq.${rid}` }, (p) => {
      const arr = State.messagesByRoom[rid] || [];
      State.messagesByRoom[rid] = arr.filter(m=>m.id!==p.old.id);
      if (State.view==='chat') renderChatMessages();
    })
    .subscribe();
}

/* ============== Online presence ============== */
async function setOnline(on){
  try { await sb.from('profiles').update({ online: on, last_seen: new Date().toISOString() }).eq('id', State.user.id); } catch{}
}
window.addEventListener('beforeunload', () => { try { navigator.sendBeacon && State.user && setOnline(false); } catch{} });

/* ============== Shell ============== */
function refresh(){ navigate(State.view); }

function initShell() {
  $('#sidebarToggle').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); toggleBackdrop(); });
  $('#sidebarClose').addEventListener('click', () => { $('#sidebar').classList.remove('open'); toggleBackdrop(); });
  $('#logoutBtn').addEventListener('click', signOut);
  $$('.nav-item').forEach(n => n.addEventListener('click', () => {
    navigate(n.dataset.view);
    if (window.innerWidth < 768) { $('#sidebar').classList.remove('open'); toggleBackdrop(); }
  }));
  $('#themeToggle').addEventListener('click', () => {
    State.settings.theme = State.settings.theme==='dark'?'light':'dark';
    localStorage.setItem('maqlama_theme', State.settings.theme);
    applyTheme();
  });
  $('#notifBtn').addEventListener('click', e => { e.stopPropagation(); $('#notifDropdown').classList.toggle('open'); });
  document.addEventListener('click', e => { if (!e.target.closest('.bell-wrap')) $('#notifDropdown').classList.remove('open'); });
  $('#markAllRead').addEventListener('click', async () => {
    const ids = State.notifications.filter(n=>!n.read && (n.user_id===State.user.id)).map(n=>n.id);
    if (ids.length) await sb.from('notifications').update({ read:true }).in('id', ids);
    State.notifications.forEach(n=>n.read=true);
    renderNotifications();
  });
  $('#clearAllNotifications').addEventListener('click', async () => {
  const notifications = State.notifications || [];

  if (!notifications.length) {
    toast('لا توجد إشعارات', 'لا يوجد شيء لمسحه', 'info');
    return;
  }

  const dismissals = notifications.map(notification => ({
    user_id: State.user.id,
    notification_id: notification.id
  }));

  const { error } = await sb
    .from('notification_dismissals')
    .upsert(dismissals, {
      onConflict: 'user_id,notification_id',
      ignoreDuplicates: true
    });

  if (error) {
    console.error('Clear notifications error:', error);
    toast('حدث خطأ', 'تعذر مسح الإشعارات', 'error');
    return;
  }

  State.notifications = [];
  renderNotifications();

  toast(
    'تم مسح الإشعارات',
    'تم مسح جميع الإشعارات الخاصة بك',
    'success'
  );
});
  $('#globalSearch').addEventListener('input', (e) => {
    if (State.view !== 'courses') navigate('courses');
    renderCoursesView(e.target.value);
  });
}

function toggleBackdrop() {
  let b = $('.sidebar-backdrop');
  if (!b) {
    b = document.createElement('div');
    b.className = 'sidebar-backdrop';
    b.addEventListener('click', ()=>{ $('#sidebar').classList.remove('open'); toggleBackdrop(); });
    document.body.appendChild(b);
  }
  b.classList.toggle('show', $('#sidebar').classList.contains('open'));
}
function applyTheme() {
  document.documentElement.classList.toggle('dark', State.settings.theme==='dark');
  const ic = $('#themeToggle i');
  if (ic) ic.className = State.settings.theme==='dark' ? 'fas fa-sun' : 'fas fa-moon';
}

/* ============== Navigation ============== */
function navigate(view) {
  State.view = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view===view));
  const wrap = $('#viewWrap'); wrap.innerHTML = '';
  const adminOnly = ['students','manageCourses','managePaths'];
  if (adminOnly.includes(view) && State.user.role !== 'admin') { toast('غير مصرح','للمدير فقط','warning'); return navigate('dashboard'); }
  switch(view){
    case 'dashboard': renderDashboard(); break;
    case 'courses':   renderCoursesView(); break;
    case 'paths':     renderPaths(); break;
    case 'chat':      renderChat(); break;
    case 'live':      renderLive(); break;
    case 'students':  renderStudents(); break;
    case 'manageCourses': renderManageCourses(); break;
    case 'managePaths':   renderManagePaths(); break;
    case 'profile':   renderProfile(); break;
    case 'settings':  renderSettings(); break;
  }
}

/* ============== Helpers (per-user filtering) ============== */
function visibleCourses() {
  if (State.user.role === 'admin') return State.courses;
  const ids = new Set(State.enrollments.map(e=>e.course_id));
  const pathIds = new Set(State.pathEnrollments.map(e=>e.path_id));
  return State.courses.filter(c => ids.has(c.id) || (c.path_id && pathIds.has(c.path_id)));
}
function visiblePaths() {
  if (State.user.role === 'admin') return State.paths;
  const pathIds = new Set(State.pathEnrollments.map(e=>e.path_id));
  return State.paths.filter(p => pathIds.has(p.id));
}
function lessonsOf(courseId){ return State.lessons.filter(l=>l.course_id===courseId); }
function profileOf(uid){ return State.profiles.find(p=>p.id===uid); }

/* ============== Views: Dashboard ============== */
function renderDashboard() {
  const studentsCount = State.profiles.filter(p=>p.role==='student').length;
  const lessonsCount = State.lessons.length;
  const my = visibleCourses().slice(0,6);
  $('#viewWrap').innerHTML = `
    <div class="page-head">
      <div><h1>أهلاً، ${escapeHtml(State.user.name)} </h1><p>هذه نظرة سريعة على نشاطك في المنصة.</p></div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-ic"><i class="fas fa-book"></i></div><div><div class="stat-val">${State.courses.length}</div><div class="stat-lbl">الكورسات</div></div></div>
      <div class="stat-card"><div class="stat-ic"><i class="fas fa-user-graduate"></i></div><div><div class="stat-val">${studentsCount}</div><div class="stat-lbl">الطلاب</div></div></div>
      <div class="stat-card"><div class="stat-ic"><i class="fas fa-video"></i></div><div><div class="stat-val">${lessonsCount}</div><div class="stat-lbl">المحاضرات</div></div></div>
      <div class="stat-card"><div class="stat-ic"><i class="fas fa-route"></i></div><div><div class="stat-val">${State.paths.length}</div><div class="stat-lbl">المسارات</div></div></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>${State.user.role==='student'?'كورساتي':'أحدث الكورسات'}</h3><button class="btn btn-ghost btn-sm" id="goCourses">عرض الكل</button></div>
      <div class="course-grid" id="dashCourses"></div>
    </div>`;
  $('#goCourses').addEventListener('click', ()=>navigate('courses'));
  renderCourseGrid('#dashCourses', my);
}

/* ============== Views: Courses ============== */
function renderCoursesView(q='') {
  let list = visibleCourses();
  if (q) {
    const s = q.trim().toLowerCase();
    list = list.filter(c => (c.title+' '+c.category+' '+(c.description||'')).toLowerCase().includes(s));
  }
  $('#viewWrap').innerHTML = `
    <div class="page-head"><div><h1>الكورسات</h1><p>تصفّح الكورسات المتاحة لك.</p></div></div>
    <div class="course-grid" id="allCourses"></div>`;
  renderCourseGrid('#allCourses', list);
}

function renderCourseGrid(sel, list) {
  const el = $(sel); if (!el) return;
  if (!list.length) { el.outerHTML = `<div class="empty"><i class="fas fa-folder-open"></i><p>لا توجد كورسات.</p></div>`; return; }
  el.innerHTML = list.map(c => `
    <div class="course-card" data-id="${c.id}">
      <div class="course-thumb" style="background:${c.cover_image ? `url('${escapeHtml(c.cover_image)}') center/cover no-repeat` : c.color}">
        ${c.cover_image ? '' : `<i class="fas ${c.icon}"></i>`}
        <span class="badge-cat">${escapeHtml(c.category||'')}</span>
      </div>
      <div class="course-body">
        <h4>${escapeHtml(c.title)}</h4>
        <p>${escapeHtml(c.description||'')}</p>
        <div class="course-meta">
          <span><i class="fas fa-play-circle"></i> ${lessonsOf(c.id).length} محاضرة</span>
          <span><i class="fas fa-clock"></i> ${escapeHtml(c.duration||'—')}</span>
        </div>
      </div>
    </div>`).join('');
  el.addEventListener('click', e => {
    const card = e.target.closest('.course-card'); if (card) openCourse(card.dataset.id);
  });
}

async function openCourse(id) {
  const c = State.courses.find(x=>x.id===id); if (!c) return;
  if (State.user.role !== 'admin' && !visibleCourses().some(x=>x.id===id)) { toast('غير مصرح','الكورس غير متاح لك','warning'); return; }
  const lessons = lessonsOf(id);
  const lessonsHtml = lessons.length ? `
    <div class="lesson-list">${lessons.map(l => `
      <div class="lesson-item" data-lid="${l.id}">
        <div class="lesson-ic"><i class="fas ${l.type==='pdf'?'fa-file-pdf':l.type==='image'?'fa-image':l.type==='file'?'fa-paperclip':'fa-play'}"></i></div>
        <div class="lesson-info"><strong>${escapeHtml(l.title)}</strong><small>${l.type} • ${escapeHtml(l.duration||'')}</small></div>
        <div class="lesson-act">
          <button class="btn btn-ghost btn-sm" data-open><i class="fas fa-${l.type==='pdf'?'eye':'play'}"></i> فتح</button>
          ${State.user.role==='admin'?`<button class="icon-btn" data-del-lesson="${l.id}" style="color:var(--danger)"><i class="fas fa-trash"></i></button>`:''}
        </div>
      </div>`).join('')}</div>`
    : `<div class="empty"><i class="fas fa-circle-info"></i><p>لا توجد محاضرات بعد.</p></div>`;
  const adminActions = State.user.role==='admin' ? `<button class="btn btn-primary btn-sm" id="addLesson"><i class="fas fa-plus"></i> إضافة محاضرة</button>` : '';
  $('#viewWrap').innerHTML = `
    <button class="btn btn-ghost btn-sm" id="back"><i class="fas fa-arrow-right"></i> رجوع</button>
    <div class="section" style="margin-top:16px">
      <div class="detail-head">
        <div class="detail-thumb" style="background:${c.color}"><i class="fas ${c.icon}"></i></div>
        <div class="detail-info">
          <h1>${escapeHtml(c.title)}</h1>
          <p>${escapeHtml(c.description||'')}</p>
          <div class="tags">
            <span class="tag"><i class="fas fa-folder"></i> ${escapeHtml(c.category||'')}</span>
            <span class="tag"><i class="fas fa-user"></i> ${escapeHtml(c.instructor||'—')}</span>
            <span class="tag"><i class="fas fa-clock"></i> ${escapeHtml(c.duration||'—')}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>المحاضرات والملفات</h3>${adminActions}</div>
      ${lessonsHtml}
    </div>`;
  $('#back').addEventListener('click', ()=>navigate('courses'));
  if ($('#addLesson')) $('#addLesson').addEventListener('click', ()=>openAddLessonModal(c.id));
  $$('.lesson-item').forEach(it => {
    it.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-lesson]')) return;
      const l = lessons.find(x=>x.id===it.dataset.lid); if (l) playLesson(l);
    });
  });
  $$('[data-del-lesson]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('حذف هذه المحاضرة؟')) return;
    const lid = b.dataset.delLesson;
    const lesson = lessons.find(x=>x.id===lid);
    if (lesson?.storage_path) { try { await sb.storage.from(BUCKET).remove([lesson.storage_path]); } catch{} }
    await sb.from('lessons').delete().eq('id', lid);
    await loadCourses(); openCourse(id);
  }));
}

// function playLesson(l) {
//   const url = l.url || '';
//   let body = `<div class="empty"><i class="fas fa-circle-info"></i><p>لا يوجد ملف.</p></div>`;
//   if (url) {
//     if (l.type==='video') body = `<div class="video-player"><video controls autoplay src="${url}" style="width:100%"></video></div>`;
//     else if (l.type==='pdf') body = `<div class="pdf-viewer"><iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe></div>`;
//     else if (l.type==='image') body = `<div style="text-align:center"><img src="${url}" style="max-width:100%;border-radius:10px"/></div>`;
//     else body = `<div style="text-align:center;padding:20px"><a class="btn btn-primary" href="${url}" target="_blank" download><i class="fas fa-download"></i> تحميل الملف</a></div>`;
//   }
//   modal({ title: l.title, body, wide:true });
// }


function playLesson(l) {
  const url = l.url || '';

  let body = `<div class="empty">
    <i class="fas fa-circle-info"></i>
    <p>لا يوجد ملف.</p>
  </div>`;

  if (url) {

    // تشغيل الفيديو
    if (l.type === 'video') {


      // الجزء ده شغتا بس حولته لتعليق
      // body = `
      // <div class="video-player">
      //   <video
      //     controls
      //     playsinline
      //     preload="metadata"
      //     controlsList="nodownload"
      //     oncontextmenu="return false;"
      //     style="width:100%;border-radius:12px"
      //   >
      //     <source src="${url}" type="video/mp4">
      //     متصفحك لا يدعم تشغيل الفيديو
      //   </video>
      // </div>`;



      body = `
<div class="video-player">
  <video
    controls
    playsinline
    preload="metadata"
    controlsList="nodownload"
    oncontextmenu="return false;"
    style="width:100%;border-radius:12px"
  >
    <source src="${url}" type="video/mp4">
    متصفحك لا يدعم تشغيل الفيديو
  </video>
</div>`;

    }
    
    // PDF
    else if (l.type === 'pdf') {

      body = `
      <div class="pdf-viewer">
        <iframe
          src="${url}"
          style="width:100%;height:70vh;border:0">
        </iframe>
      </div>`;

    }

    // صورة
    else if (l.type === 'image') {

      body = `
      <div style="text-align:center">
        <img
          src="${url}"
          style="max-width:100%;border-radius:10px"/>
      </div>`;

    }

    // ملفات أخرى
    else {

      body = `
      <div style="text-align:center;padding:20px">
        <a class="btn btn-primary"
           href="${url}"
           target="_blank"
           download>
          <i class="fas fa-download"></i>
          تحميل الملف
        </a>
      </div>`;

    }
  }

  modal({
    title: l.title,
    body,
    wide: true
  });
}




/* ============== Upload to Storage with progress ============== */
async function uploadFile(file, folder='uploads') {
  const safe = file.name.replace(/[^\w.\-]/g,'_');
  const path = `${folder}/${State.user.id}/${Date.now()}_${safe}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert:false, contentType: file.type });
  if (error) throw error;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, name: file.name, type: file.type, size: file.size };
}

function openAddLessonModal(courseId) {
  const body = `<div class="form">
    <div class="field"><label>عنوان المحاضرة</label><input id="lTitle" placeholder="مثال: مقدمة في..." /></div>
    <div class="field"><label>النوع</label>
      <select id="lType">
        <option value="video">فيديو</option><option value="pdf">PDF</option>
        <option value="image">صورة</option><option value="file">ملف</option>
      </select>
    </div>
    <div class="field"><label>المدة (اختياري)</label><input id="lDur" placeholder="15 د" /></div>
    <div class="field"><label>رفع الملف</label><input id="lFile" type="file" /></div>
    <div class="field"><label>أو رابط خارجي</label><input id="lUrl" placeholder="https://..." /></div>
    <div class="upload-progress" id="lProg" style="display:none"><div></div></div>
  </div>`;
  const footer = `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="saveLesson"><i class="fas fa-save"></i> حفظ</button>`;
  const m = modal({ title:'إضافة محاضرة', body, footer });
  m.root.querySelector('[data-close]').addEventListener('click', m.close);
  m.root.querySelector('#saveLesson').addEventListener('click', async () => {
    const title = m.root.querySelector('#lTitle').value.trim();
    const type = m.root.querySelector('#lType').value;
    const dur = m.root.querySelector('#lDur').value.trim();
    const file = m.root.querySelector('#lFile').files[0];
    const urlIn = m.root.querySelector('#lUrl').value.trim();
    if (!title) return toast('عنوان مطلوب','','warning');
    let url = urlIn, storage_path = null;
    if (file) {
      const prog = m.root.querySelector('#lProg'); prog.style.display=''; prog.firstElementChild.style.width='30%';
      try { const r = await uploadFile(file, 'lessons'); url = r.url; storage_path = r.path; prog.firstElementChild.style.width='100%'; }
      catch(e){ console.error(e); return toast('فشل الرفع', e.message,'error'); }
    }
    const { error } = await sb.from('lessons').insert({ course_id: courseId, title, type, duration: dur||null, url, storage_path });
    if (error) return toast('فشل الحفظ', error.message,'error');
    await sb.from('notifications').insert({ user_id: null, title:'محاضرة جديدة', body:`أُضيفت "${title}"`, icon:'fa-plus' });
    toast('تم الحفظ','','success'); m.close();
    await loadCourses(); openCourse(courseId);
  });
}

/* ============== Views: Paths ============== */
function renderPaths(){
  const list = visiblePaths();
  $('#viewWrap').innerHTML = `
    <div class="page-head"><div><h1>المسارات التعليمية</h1><p>المسارات التي تم تخصيصها لك.</p></div></div>
    <div class="course-grid" id="pathsGrid"></div>`;
  const g = $('#pathsGrid');
  if (!list.length) { g.outerHTML = `<div class="empty"><i class="fas fa-route"></i><p>لا توجد مسارات.</p></div>`; return; }
  g.innerHTML = list.map(p => {
    const courses = State.courses.filter(c=>c.path_id===p.id);
    return `<div class="path-card" data-pid="${p.id}">
      <div class="path-thumb" style="background:${p.cover_image ? `url('${escapeHtml(p.cover_image)}') center/cover no-repeat` : p.color}">${p.cover_image ? '' : `<i class="fas ${p.icon}"></i>`}</div>
      <h4>${escapeHtml(p.title)}</h4>
      <p class="muted">${escapeHtml(p.description||'')}</p>
      <div class="course-meta" style="margin-top:10px"><span><i class="fas fa-book"></i> ${courses.length} كورس</span></div>
    </div>`;
  }).join('');
  g.addEventListener('click', e => {
    const card = e.target.closest('.path-card'); if (!card) return;
    const p = State.paths.find(x=>x.id===card.dataset.pid);
    const courses = State.courses.filter(c=>c.path_id===p.id);
    modal({ title:p.title, wide:true, body:`
      <p>${escapeHtml(p.description||'')}</p>
      <div class="course-grid" id="pmCourses" style="margin-top:14px"></div>
    `});
    setTimeout(()=>renderCourseGrid('#pmCourses', courses),10);
  });
}

/* ============== Views: Manage Paths (Admin) ============== */
function renderManagePaths(){
  $('#viewWrap').innerHTML = `
    <div class="page-head">
      <div><h1>إدارة المسارات</h1><p>إنشاء وتعديل المسارات التعليمية.</p></div>
      <button class="btn btn-primary" id="addPath"><i class="fas fa-plus"></i> مسار جديد</button>
    </div>
    <div class="section"><div class="table-wrap"><table>
      <thead><tr><th>المسار</th><th>الوصف</th><th>الكورسات</th><th></th></tr></thead>
      <tbody>${State.paths.map(p=>`
        <tr><td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="background:${p.color};width:34px;height:34px;color:#fff"><i class="fas ${p.icon}"></i></div>${escapeHtml(p.title)}</div></td>
        <td>${escapeHtml(p.description||'')}</td>
        <td>${State.courses.filter(c=>c.path_id===p.id).length}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-path="${p.id}"><i class="fas fa-pen"></i></button>
          <button class="icon-btn" data-del-path="${p.id}" style="color:var(--danger)"><i class="fas fa-trash"></i></button>
        </div></td></tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#addPath').addEventListener('click', ()=>openPathModal());
  $$('[data-edit-path]').forEach(b=>b.addEventListener('click',()=>openPathModal(b.dataset.editPath)));
  $$('[data-del-path]').forEach(b=>b.addEventListener('click', async ()=>{
    if (!confirm('حذف هذا المسار؟')) return;
    await sb.from('learning_paths').delete().eq('id', b.dataset.delPath);
    await loadPaths(); renderManagePaths();
  }));
}

function openPathModal(id){
  const p = id ? State.paths.find(x=>x.id===id) : { title:'',description:'',icon:'fa-route',color:'linear-gradient(135deg,#4f46e5,#06b6d4)',cover_image:null};
  const body = `<div class="form">
    <div class="field"><label>العنوان</label><input id="pTitle" value="${escapeHtml(p.title)}"/></div>
    <div class="field"><label>الوصف</label><textarea id="pDesc" rows="3">${escapeHtml(p.description||'')}</textarea></div>
    <div class="field"><label>أيقونة</label><input id="pIcon" value="${escapeHtml(p.icon)}" placeholder="fa-route"/></div>
    <div class="field"><label>صورة الغلاف</label><input id="pCover" type="file" accept="image/*"/></div>
    ${p.cover_image ? `<div class="muted">الصورة الحالية محفوظة، ويمكن استبدالها برفع صورة جديدة.</div>` : ''}
  </div>`;
  const m = modal({ title: id?'تعديل مسار':'مسار جديد', body, footer:`<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="savePath">حفظ</button>`});
  m.root.querySelector('[data-close]').addEventListener('click', m.close);
  m.root.querySelector('#savePath').addEventListener('click', async ()=>{
    const data = {
      title: m.root.querySelector('#pTitle').value.trim(),
      description: m.root.querySelector('#pDesc').value.trim(),
      icon: m.root.querySelector('#pIcon').value.trim() || 'fa-route',
      cover_image: p.cover_image || null,
    };
    if (!data.title) return toast('العنوان مطلوب','','warning');
    const file = m.root.querySelector('#pCover').files[0];
    if (file) {
      try { const r = await uploadFile(file, 'paths'); data.cover_image = r.url; }
      catch (e) { return toast('فشل رفع الصورة', e.message || 'تعذر رفع الصورة', 'error'); }
    }
    if (id) await sb.from('learning_paths').update(data).eq('id', id);
    else await sb.from('learning_paths').insert(data);
    await loadPaths(); m.close(); renderManagePaths(); toast('تم الحفظ','','success');
  });
}

/* ============== Views: Chat ============== */
let chatAttachment = null;

function renderChat() {
  if (!State.rooms.length) { $('#viewWrap').innerHTML = `<div class="empty"><p>لا توجد غرف.</p></div>`; return; }
  if (!State.rooms.find(r=>r.id===State.currentRoom)) State.currentRoom = State.rooms[0].id;
  $('#viewWrap').innerHTML = `
    <div class="chat-wrap">
      <div class="chat-rooms">
        <div class="chat-rooms-head">الغرف</div>
        ${State.rooms.map(r=>`
          <div class="chat-room ${r.id===State.currentRoom?'active':''}" data-rid="${r.id}">
            <div class="avatar"><i class="fas ${r.icon}"></i></div>
            <div class="chat-room-info"><strong>${escapeHtml(r.name)}</strong><small>اضغط لفتح الغرفة</small></div>
          </div>`).join('')}
      </div>
      <div class="chat-area">
        <div class="chat-head"><div class="avatar" id="rIc"></div><div><strong id="rName"></strong><br/><small class="muted" id="rDesc"></small></div></div>
        <div class="chat-body" id="chatBody"></div>
        <div id="chatAttachPreview"></div>
        <form class="chat-input" id="chatForm">
          <label class="icon-btn" title="إرفاق ملف"><i class="fas fa-paperclip"></i><input type="file" id="chatFile" hidden accept="image/*,video/*,application/pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"/></label>
          <input id="chatMsg" placeholder="اكتب رسالتك..." autocomplete="off" />
          <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i></button>
        </form>
      </div>
    </div>`;
  $$('.chat-room').forEach(r => r.addEventListener('click', async () => {
    State.currentRoom = r.dataset.rid;
    $$('.chat-room').forEach(x => x.classList.toggle('active', x===r));
    await loadRoomMessages(); subscribeRoom();
  }));
  $('#chatFile').addEventListener('change', e => {
    chatAttachment = e.target.files[0] || null;
    renderAttachPreview();
  });
  $('#chatForm').addEventListener('submit', sendMessage);
  loadRoomMessages().then(subscribeRoom);
}

function renderAttachPreview(){
  const el = $('#chatAttachPreview');
  if (!chatAttachment) { el.innerHTML=''; return; }
  el.innerHTML = `<div class="chat-attach-preview"><span><i class="fas fa-paperclip"></i> ${escapeHtml(chatAttachment.name)} (${Math.round(chatAttachment.size/1024)}KB)</span><button type="button" id="rmAtt"><i class="fas fa-xmark"></i></button></div>`;
  $('#rmAtt').addEventListener('click', () => { chatAttachment=null; $('#chatFile').value=''; renderAttachPreview(); });
}

async function sendMessage(e) {
  e.preventDefault();
  const text = $('#chatMsg').value.trim();
  if (!text && !chatAttachment) return;
  $('#chatMsg').value=''; const file = chatAttachment; chatAttachment=null; $('#chatFile').value='';
  renderAttachPreview();
  let attachment_url=null, attachment_type=null, attachment_name=null;
  if (file) {
    try {
      // show inline progress placeholder
      const tmp = document.createElement('div'); tmp.className='upload-progress'; tmp.innerHTML='<div style="width:50%"></div>';
      $('#chatBody').appendChild(tmp); $('#chatBody').scrollTop = $('#chatBody').scrollHeight;
      const r = await uploadFile(file, 'chat');
      attachment_url = r.url; attachment_type = file.type; attachment_name = file.name;
      tmp.remove();
    } catch(err){ console.error(err); return toast('فشل رفع المرفق', err.message, 'error'); }
  }
  const { error } = await sb.from('chat_messages').insert({
    room_id: State.currentRoom, user_id: State.user.id, user_name: State.user.name,
    text: text || null, attachment_url, attachment_type, attachment_name
  });
  if (error) toast('فشل الإرسال', error.message,'error');
}

async function loadRoomMessages(){
  const rid = State.currentRoom;
  const { data, error } = await sb.from('chat_messages').select('*').eq('room_id', rid)
    .order('created_at',{ascending:true}).limit(200);
  if (error) return console.error(error);
  State.messagesByRoom[rid] = data || [];
  renderChatMessages();
}

function renderChatMessages() {
  const rid = State.currentRoom;
  const room = State.rooms.find(r=>r.id===rid); if (!room || !$('#chatBody')) return;
  const msgs = State.messagesByRoom[rid] || [];
  $('#rName').textContent = room.name;
  $('#rDesc').textContent = msgs.length+' رسالة';
  $('#rIc').innerHTML = `<i class="fas ${room.icon}"></i>`;
  const body = $('#chatBody');
  const wasBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
  body.innerHTML = msgs.map(m => {
    const me = m.user_id === State.user.id;
    const prof = profileOf(m.user_id);
    const online = prof?.online;
    const canDel = State.user.role==='admin' || me;
    let attHtml = '';
    if (m.attachment_url) {
      if ((m.attachment_type||'').startsWith('image/')) attHtml = `<img class="chat-img" src="${m.attachment_url}" onclick="window.open('${m.attachment_url}','_blank')"/>`;
      else if ((m.attachment_type||'').startsWith('video/')) attHtml = `<video controls src="${m.attachment_url}" style="max-width:280px;border-radius:10px;margin-top:6px"></video>`;
      else attHtml = `<a class="chat-file" href="${m.attachment_url}" target="_blank" download="${escapeHtml(m.attachment_name||'file')}"><i class="fas fa-paperclip"></i> ${escapeHtml(m.attachment_name||'تحميل الملف')}</a>`;
    }
    return `<div class="msg ${me?'me':''}">
      <div class="avatar">${escapeHtml((m.user_name||'?')[0])}<span class="online-dot ${online?'on':''}"></span></div>
      <div class="msg-bubble">
        ${!me?`<strong style="font-size:12px;color:var(--primary)">${escapeHtml(m.user_name)}</strong><br/>`:''}
        ${m.text?escapeHtml(m.text):''}
        ${attHtml}
        <small>${fmtTime(m.created_at)}</small>
      </div>
      ${canDel?`<button class="msg-del" data-del="${m.id}" title="حذف"><i class="fas fa-trash"></i></button>`:''}
    </div>`;
  }).join('');
  if (wasBottom) body.scrollTop = body.scrollHeight;
  $$('.msg-del').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('حذف الرسالة؟')) return;
    await sb.from('chat_messages').delete().eq('id', b.dataset.del);
  }));
}

/* ============== Views: Live Stream ============== */
function renderLive() {
  const isAdmin = State.user.role==='admin';
  const s = State.liveStream;
  const adminCtl = isAdmin ? `<div class="section">
    <div class="section-head"><h3>تحكّم الأدمن</h3>
      ${s ? `<button class="btn btn-danger" id="stopLive"><i class="fas fa-stop"></i> إيقاف البث</button>`
           : `<button class="btn btn-primary" id="startLive"><i class="fas fa-tower-broadcast"></i> بدء البث</button>`}
    </div>
    <p class="muted">يتم البث عبر رابط HLS أو رابط يوتيوب/iframe. الطلاب يشاهدوا مباشرة دون إعادة تحميل.</p>
  </div>` : '';
  let player = `<div class="empty"><i class="fas fa-tower-broadcast"></i><p>لا يوجد بث مباشر حالياً.</p></div>`;
  if (s) {
    if (s.kind==='hls') player = `<div class="live-player"><video id="liveV" controls autoplay playsinline></video></div>`;
    else if (s.kind==='youtube') {
      const id = (s.url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)||[])[1] || s.url;
      player = `<div class="live-player"><iframe src="https://www.youtube.com/embed/${id}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>`;
    } else player = `<div class="live-player"><iframe src="${s.url}" allow="autoplay; fullscreen"></iframe></div>`;
  }
  $('#viewWrap').innerHTML = `
    <div class="page-head"><div><h1>البث المباشر</h1><p>${s?escapeHtml(s.title):'انتظر بدء البث من قِبَل المدير.'}</p></div></div>
    ${adminCtl}
    <div class="section">${player}</div>`;
  if (s && s.kind==='hls' && $('#liveV')) {
    const v = $('#liveV');
    if (window.Hls && window.Hls.isSupported()) { const h = new Hls(); h.loadSource(s.url); h.attachMedia(v); }
    else { v.src = s.url; }
  }
  if (isAdmin) {
    if ($('#startLive')) $('#startLive').addEventListener('click', openStartLiveModal);
    if ($('#stopLive')) $('#stopLive').addEventListener('click', async () => {
      await sb.from('live_streams').update({ active:false }).eq('id', s.id);
      await loadActiveLive(); renderLive();
    });
  }
}

function openStartLiveModal(){
  const body = `<div class="form">
    <div class="field"><label>عنوان البث</label><input id="lvTitle" placeholder="حصة اليوم"/></div>
    <div class="field"><label>نوع المصدر</label>
      <select id="lvKind">
        <option value="hls">HLS (m3u8)</option>
        <option value="youtube">يوتيوب</option>
        <option value="iframe">رابط iframe</option>
      </select>
    </div>
    <div class="field"><label>الرابط</label><input id="lvUrl" placeholder="https://..."/></div>
  </div>`;
  const m = modal({ title:'بدء بث مباشر', body, footer:`<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="goLive">بث</button>`});
  m.root.querySelector('[data-close]').addEventListener('click', m.close);
  m.root.querySelector('#goLive').addEventListener('click', async ()=>{
    const title = m.root.querySelector('#lvTitle').value.trim() || 'بث مباشر';
    const kind = m.root.querySelector('#lvKind').value;
    const url = m.root.querySelector('#lvUrl').value.trim();
    if (!url) return toast('الرابط مطلوب','','warning');
    // close any active stream first
    await sb.from('live_streams').update({ active:false }).eq('active', true);
    await sb.from('live_streams').insert({ title, kind, url, started_by: State.user.id, active:true });
    await sb.from('notifications').insert({ user_id:null, title:'بث مباشر', body:title, icon:'fa-tower-broadcast' });
    m.close(); await loadActiveLive(); renderLive();
  });
}

/* ============== Views: Students (Admin) ============== */
function renderStudents() {
  const students = State.profiles.filter(p=>p.role==='student');
  $('#viewWrap').innerHTML = `
    <div class="page-head">
      <div><h1>الطلاب</h1><p>إضافة، حذف وإدارة وصول الطلاب للكورسات والمسارات.</p></div>
      <button class="btn btn-primary" id="addStu"><i class="fas fa-plus"></i> إضافة طالب</button>
    </div>
    <div class="section"><div class="table-wrap"><table>
      <thead><tr><th>الطالب</th><th>المستخدم</th><th>البريد</th><th>الحالة</th><th>كورسات</th><th>الانضمام</th><th></th></tr></thead>
      <tbody>${students.map(s=>`
        <tr>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="width:34px;height:34px;font-size:13px">${escapeHtml(s.avatar||s.name[0])}<span class="online-dot ${s.online?'on':''}"></span></div>${escapeHtml(s.name)}</div></td>
          <td>${escapeHtml(s.username)}</td><td>${escapeHtml(s.email||'—')}</td>
          <td>${s.online?'<span style="color:var(--success)">●  متصل</span>':'<span class="muted">●  غير متصل</span>'}</td>
          <td>${State.enrollments.filter(e=>e.user_id===s.id).length}</td>
          <td>${fmtDate(s.joined_at)}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-access="${s.id}" title="إدارة الوصول"><i class="fas fa-key"></i></button>
            <button class="icon-btn" data-del-stu="${s.id}" style="color:var(--danger)"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#addStu').addEventListener('click', openStudentModal);
  $$('[data-access]').forEach(b=>b.addEventListener('click',()=>openAccessModal(b.dataset.access)));
  $$('[data-del-stu]').forEach(b=>b.addEventListener('click', async ()=>{
    if (!confirm('حذف الطالب؟ (يتم حذف الملف الشخصي فقط؛ حذف حساب Auth يتم من لوحة Supabase)')) return;
    await sb.from('profiles').delete().eq('id', b.dataset.delStu);
    await loadProfiles(); renderStudents();
  }));
}

function openStudentModal(){
  const body = `<div class="form">
    <div class="field"><label>الاسم</label><input id="sName"/></div>
    <div class="field"><label>اسم المستخدم</label><input id="sUser" placeholder="user1"/></div>
    <div class="field"><label>البريد (اختياري)</label><input id="sEmail" placeholder="user@example.com"/></div>
    <div class="field"><label>كلمة المرور (8 أحرف على الأقل)</label><input id="sPass" type="text" value="student1234"/></div>
  </div>`;
  const m = modal({ title:'طالب جديد', body, footer:`<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="saveStu">إنشاء</button>`});
  m.root.querySelector('[data-close]').addEventListener('click', m.close);
  m.root.querySelector('#saveStu').addEventListener('click', async ()=>{
    const name = m.root.querySelector('#sName').value.trim();
    const username = m.root.querySelector('#sUser').value.trim().toLowerCase();
    const emailIn = m.root.querySelector('#sEmail').value.trim();
    const password = m.root.querySelector('#sPass').value;
    if (!name||!username||password.length<6) return toast('بيانات ناقصة','','warning');
    const email = emailIn || usernameToEmail(username);
    const { data: { session } } = await sb.auth.getSession();

if (!session) {
  return toast('انتهت الجلسة', 'سجّل دخولك كمدير مرة أخرى', 'error');
}

const response = await fetch(
  `${SUPABASE_URL}/functions/v1/admin-users`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_KEY
    },
    body: JSON.stringify({
      action: 'create',
      role: 'student',
      email,
      password,
      name,
      username
    })
  }
);

const result = await response.json();

if (!response.ok) {
  return toast('فشل إنشاء الطالب', result.error || 'حدث خطأ غير معروف', 'error');
}
    if (error) return toast('فشل الإنشاء', error.message,'error');
    toast('تم إنشاء الطالب','','success'); m.close();
    setTimeout(async ()=>{ await loadProfiles(); renderStudents(); }, 800);
  });
}

function openAccessModal(uid){
  const u = State.profiles.find(p=>p.id===uid); if (!u) return;
  const enrolledCourses = new Set(State.enrollments.filter(e=>e.user_id===uid).map(e=>e.course_id));
  const enrolledPaths = new Set(State.pathEnrollments.filter(e=>e.user_id===uid).map(e=>e.path_id));
  const coursesHtml = State.courses.map(c=>`<label class="check"><input type="checkbox" data-course="${c.id}" ${enrolledCourses.has(c.id)?'checked':''}/> <span>${escapeHtml(c.title)}</span></label>`).join('');
  const pathsHtml = State.paths.map(p=>`<label class="check"><input type="checkbox" data-path="${p.id}" ${enrolledPaths.has(p.id)?'checked':''}/> <span>${escapeHtml(p.title)}</span></label>`).join('');
  const body = `<h4>الكورسات</h4><div class="form" style="max-height:200px;overflow:auto;border:1px solid var(--border);padding:10px;border-radius:10px">${coursesHtml||'<p class="muted">لا توجد كورسات</p>'}</div>
    <h4 style="margin-top:14px">المسارات</h4><div class="form" style="max-height:200px;overflow:auto;border:1px solid var(--border);padding:10px;border-radius:10px">${pathsHtml||'<p class="muted">لا توجد مسارات</p>'}</div>`;
  const m = modal({ title:`إدارة وصول: ${u.name}`, body, wide:true, footer:`<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="saveAcc">حفظ</button>`});
  m.root.querySelector('[data-close]').addEventListener('click', m.close);
  m.root.querySelector('#saveAcc').addEventListener('click', async ()=>{
    const wantCourses = [...m.root.querySelectorAll('[data-course]:checked')].map(x=>x.dataset.course);
    const wantPaths = [...m.root.querySelectorAll('[data-path]:checked')].map(x=>x.dataset.path);
    await sb.from('enrollments').delete().eq('user_id', uid);
    if (wantCourses.length) await sb.from('enrollments').insert(wantCourses.map(cid=>({ user_id: uid, course_id: cid })));
    await sb.from('path_enrollments').delete().eq('user_id', uid);
    if (wantPaths.length) await sb.from('path_enrollments').insert(wantPaths.map(pid=>({ user_id: uid, path_id: pid })));
    await sb.from('notifications').insert({ user_id: uid, title:'تحديث وصولك', body:'تم تحديث الكورسات والمسارات المتاحة لك', icon:'fa-key' });
    await loadEnrollments(); m.close(); toast('تم الحفظ','','success');
  });
}

/* ============== Views: Manage Courses (Admin) ============== */
function renderManageCourses() {
  $('#viewWrap').innerHTML = `
    <div class="page-head">
      <div><h1>إدارة الكورسات</h1><p>إضافة وتعديل وحذف الكورسات.</p></div>
      <button class="btn btn-primary" id="addC"><i class="fas fa-plus"></i> كورس جديد</button>
    </div>
    <div class="section"><div class="table-wrap"><table>
      <thead><tr><th>الكورس</th><th>القسم</th><th>المسار</th><th>المدرّس</th><th>محاضرات</th><th></th></tr></thead>
      <tbody>${State.courses.map(c=>{
        const p = State.paths.find(x=>x.id===c.path_id);
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="background:${c.color};width:34px;height:34px;color:#fff"><i class="fas ${c.icon}"></i></div>${escapeHtml(c.title)}</div></td>
          <td><span class="tag">${escapeHtml(c.category||'')}</span></td>
          <td>${p?escapeHtml(p.title):'—'}</td>
          <td>${escapeHtml(c.instructor||'—')}</td>
          <td>${lessonsOf(c.id).length}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-open-c="${c.id}"><i class="fas fa-eye"></i></button>
            <button class="icon-btn" data-edit-c="${c.id}"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" data-del-c="${c.id}" style="color:var(--danger)"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
  $('#addC').addEventListener('click',()=>openCourseModal());
  $$('[data-open-c]').forEach(b=>b.addEventListener('click',()=>openCourse(b.dataset.openC)));
  $$('[data-edit-c]').forEach(b=>b.addEventListener('click',()=>openCourseModal(b.dataset.editC)));
  $$('[data-del-c]').forEach(b=>b.addEventListener('click', async ()=>{
    if (!confirm('حذف الكورس وكل محاضراته؟')) return;
    await sb.from('courses').delete().eq('id', b.dataset.delC);
    await loadCourses(); renderManageCourses();
  }));
}

function openCourseModal(id){
  const c = id ? State.courses.find(x=>x.id===id) : { title:'',category:'',description:'',instructor:'',instructor_image:null,cover_image:null,duration:'',icon:'fa-book',color:'linear-gradient(135deg,#4f46e5,#06b6d4)',path_id:null };
  const pathOpts = `<option value="">— بدون مسار —</option>` + State.paths.map(p=>`<option value="${p.id}" ${c.path_id===p.id?'selected':''}>${escapeHtml(p.title)}</option>`).join('');
  const body = `<div class="form">
    <div class="field"><label>العنوان</label><input id="cTitle" value="${escapeHtml(c.title)}"/></div>
    <div class="field"><label>القسم</label><input id="cCat" value="${escapeHtml(c.category||'')}"/></div>
    <div class="field"><label>الوصف</label><textarea id="cDesc" rows="3">${escapeHtml(c.description||'')}</textarea></div>
    <div class="field"><label>المدرّس</label><input id="cIns" value="${escapeHtml(c.instructor||'')}"/></div>
    <div class="field"><label>صورة المدرّس</label><input id="cInsImg" type="file" accept="image/*"/></div>
    <div class="field"><label>صورة غلاف الكورس</label><input id="cCover" type="file" accept="image/*"/></div>
    <div class="field"><label>المدة</label><input id="cDur" value="${escapeHtml(c.duration||'')}"/></div>
    <div class="field"><label>الأيقونة</label><input id="cIcon" value="${escapeHtml(c.icon)}"/></div>
    <div class="field"><label>المسار التعليمي</label><select id="cPath">${pathOpts}</select></div>
  </div>`;
  const m = modal({ title: id?'تعديل كورس':'كورس جديد', body, footer:`<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="saveC">حفظ</button>`});
  m.root.querySelector('[data-close]').addEventListener('click', m.close);
  m.root.querySelector('#saveC').addEventListener('click', async ()=>{
    const data = {
      title: m.root.querySelector('#cTitle').value.trim(),
      category: m.root.querySelector('#cCat').value.trim()||'عام',
      description: m.root.querySelector('#cDesc').value.trim(),
      instructor: m.root.querySelector('#cIns').value.trim(),
      instructor_image: c.instructor_image || null,
      cover_image: c.cover_image || null,
      duration: m.root.querySelector('#cDur').value.trim(),
      icon: m.root.querySelector('#cIcon').value.trim()||'fa-book',
      path_id: m.root.querySelector('#cPath').value || null,
    };
    if (!data.title) return toast('العنوان مطلوب','','warning');
    const cover = m.root.querySelector('#cCover').files[0];
    const insImg = m.root.querySelector('#cInsImg').files[0];
    try {
      if (cover) data.cover_image = (await uploadFile(cover, 'courses')).url;
      if (insImg) data.instructor_image = (await uploadFile(insImg, 'instructors')).url;
    } catch (e) { return toast('فشل رفع الصورة', e.message || 'تعذر رفع الصورة', 'error'); }
    if (id) await sb.from('courses').update(data).eq('id', id);
    else await sb.from('courses').insert(data);
    await loadCourses(); m.close(); renderManageCourses(); toast('تم الحفظ','','success');
  });
}

/* ============== Views: Profile ============== */
function renderProfile() {
  const u = State.user;
  const enrolled = visibleCourses();
  $('#viewWrap').innerHTML = `
    <div class="page-head"><div><h1>الملف الشخصي</h1><p>بياناتك على المنصة.</p></div></div>
    <div class="section">
      <div class="profile-card">
        <div class="profile-avatar">${escapeHtml(u.avatar||u.name[0])}</div>
        <div class="profile-info">
          <h2>${escapeHtml(u.name)}</h2>
          <p>${u.role==='admin'?'مدير المنصة':'طالب'} • ${escapeHtml(u.email||'')}</p>
          <div class="tags" style="margin-top:8px">
            <span class="tag"><i class="fas fa-calendar"></i> ${fmtDate(u.joined_at)}</span>
            <span class="tag"><i class="fas fa-graduation-cap"></i> ${enrolled.length} كورس</span>
          </div>
        </div>
      </div>
      <div class="kv-grid">
        <div class="kv"><small>الاسم</small><strong>${escapeHtml(u.name)}</strong></div>
        <div class="kv"><small>المستخدم</small><strong>${escapeHtml(u.username)}</strong></div>
        <div class="kv"><small>الدور</small><strong>${u.role==='admin'?'مدير':'طالب'}</strong></div>
        <div class="kv"><small>الكورسات المتاحة</small><strong>${enrolled.length}</strong></div>
      </div>
    </div>
    ${u.role==='student'?`<div class="section"><div class="section-head"><h3>كورساتي</h3></div><div class="course-grid" id="myCourses"></div></div>`:''}`;
  if (u.role==='student') renderCourseGrid('#myCourses', enrolled);
}

/* ============== Views: Settings ============== */
function renderSettings() {
  $('#viewWrap').innerHTML = `
    <div class="page-head"><div><h1>الإعدادات</h1><p>خصّص تجربتك.</p></div></div>
    <div class="section"><h3 style="margin-bottom:16px">المظهر</h3>
      <div class="form">
        <div class="field"><label>الوضع</label>
          <select id="setTheme">
            <option value="light" ${State.settings.theme==='light'?'selected':''}>فاتح</option>
            <option value="dark"  ${State.settings.theme==='dark' ?'selected':''}>ليلي</option>
          </select>
        </div>
      </div>
    </div>
    <div class="section">
      <h3 style="margin-bottom:10px">معلومات الاتصال</h3>
      <p class="muted">Supabase: ${sb?'<span style="color:var(--success)">متصل ✓</span>':'<span style="color:var(--danger)">غير مفعّل</span>'}</p>
    </div>`;
  $('#setTheme').addEventListener('change', e => {
    State.settings.theme = e.target.value;
    localStorage.setItem('maqlama_theme', State.settings.theme);
    applyTheme();
  });
}

/* ============== Notifications UI ============== */
function renderNotifications() {
  const list = State.notifications || [];
  const unread = list.filter(n => !n.read).length;

  const badge = $('#notifBadge');
  if (badge) {
    badge.textContent = unread;
    badge.style.display = unread ? 'grid' : 'none';
  }

  const wrap = $('#notifList');
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `<div class="notif-empty">لا توجد إشعارات</div>`;
    return;
  }

  wrap.innerHTML = list.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-nid="${n.id}">
      <div class="ic">
        <i class="fas ${n.icon || 'fa-bell'}"></i>
      </div>

      <div class="meta">
        <strong>${escapeHtml(n.title)}</strong>
        <p>${escapeHtml(n.body || '')}</p>
        <small>${fmtTime(n.created_at)}</small>
      </div>

      <button
        type="button"
        class="notif-delete"
        data-delete-notification="${n.id}">
        حذف
      </button>
    </div>
  `).join('');

  // الضغط على الإشعار = تحديده كمقروء
  $$('.notif-item').forEach(it => {
    it.addEventListener('click', async (e) => {

      // لو الضغط كان على زر حذف، لا نعتبر الإشعار مقروءًا
      if (e.target.closest('.notif-delete')) return;

      const id = it.dataset.nid;

      await sb
        .from('notifications')
        .update({ read: true })
        .eq('id', id);

      const notification = State.notifications.find(n => n.id === id);
      if (notification) notification.read = true;

      renderNotifications();
    });
  });

  // حذف إشعار واحد
  $$('.notif-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const notificationId = btn.dataset.deleteNotification;

      const { error } = await sb
        .from('notification_dismissals')
        .upsert(
          {
            user_id: State.user.id,
            notification_id: notificationId
          },
          {
            onConflict: 'user_id,notification_id',
            ignoreDuplicates: true
          }
        );

      if (error) {
        console.error('Delete notification error:', error);
        toast('حدث خطأ', 'تعذر حذف الإشعار', 'error');
        return;
      }

      // حذف الإشعار من القائمة الحالية مباشرة
      State.notifications = State.notifications.filter(
        n => n.id !== notificationId
      );

      renderNotifications();

      toast(
        'تم الحذف',
        'تم حذف الإشعار',
        'success'
      );
    });
  });
}

/* ============== Boot ============== */
window.addEventListener('DOMContentLoaded', async () => {
  cacheLoad(); applyTheme();
  initLogin(); initShell();
  setTimeout(async () => {
    $('#loadingScreen').classList.add('fade-out');
    setTimeout(()=>$('#loadingScreen').remove(), 400);
    if (!sb) {
      $('#loginPage').classList.remove('hidden');
      toast('Supabase غير مفعّل','عدّل env.js وأعد التحميل','warning');
      return;
    }
    // try ensure default admin (silent)
    ensureDefaultAdmin().catch(()=>{});
    // restore session
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      try { await afterLogin(); }
      catch(e){ console.error(e); $('#loginPage').classList.remove('hidden'); }
    } else {
      $('#loginPage').classList.remove('hidden');
    }
    // listen for auth changes
    sb.auth.onAuthStateChange(async (_e, sess) => {
      if (sess && !State.user) { try { await afterLogin(); } catch(e){ console.error(e); } }
    });
  }, 600);
});












