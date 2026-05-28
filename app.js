import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const MODULES = [
  { key: "rw1", title: "Reading and Writing Module 1", short: "RW 1", area: "rw", duration: 32 },
  { key: "rw2", title: "Reading and Writing Module 2", short: "RW 2", area: "rw", duration: 32 },
  { key: "math1", title: "Math Module 1", short: "Math 1", area: "math", duration: 35 },
  { key: "math2", title: "Math Module 2", short: "Math 2", area: "math", duration: 35 }
];

const PRELOADED_MANIFEST_URL = "./preloaded/April%204%20-%20May%2024%20SATs/manifest.json";

const root = document.querySelector("#app");
const LOGO_URL = "https://dnhcollege.com/wp-content/uploads/2024/01/logo1.png";
const config = window.DH_FIREBASE_CONFIG || {};
const state = {
  auth: null,
  db: null,
  storage: null,
  user: null,
  profile: null,
  view: "login",
  authMode: "login",
  adminTab: "upload",
  message: null,
  tests: [],
  preloadedTests: [],
  attempts: [],
  users: [],
  uploadDraft: null,
  editDraft: null,
  activeTest: null,
  activeAttempt: null,
  activeModule: "rw1",
  activeQuestion: 0,
  timer: null,
  timerLeft: 0,
  sortScores: "date",
  reviewAttempt: null,
  creatingAccount: false
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (!isConfigured()) {
    renderFirebaseSetup();
    return;
  }

  try {
    const firebaseApp = initializeApp(config);
    state.auth = getAuth(firebaseApp);
    state.db = getFirestore(firebaseApp);
    state.storage = getStorage(firebaseApp);
    await loadPreloadedTests();
    await setPersistence(state.auth, inMemoryPersistence);

    onAuthStateChanged(state.auth, async (user) => {
      clearTimer();

      // During sign-up, wait for register() to create the Firestore profile first.
      if (state.creatingAccount && user) {
        state.user = user;
        return;
      }

      try {
        state.user = user;
        state.profile = user ? await getProfile(user.uid) : null;
        if (user && !state.profile) {
          state.message = {
            type: "error",
            text: "This login exists in Firebase Auth, but no Firestore profile was found. Delete this user in Firebase Authentication and sign up again."
          };
        }
        await refreshData();
        state.view = user && state.profile ? (state.profile.role === "admin" ? "admin" : "dashboard") : "login";
        render();
      } catch (error) {
        state.message = { type: "error", text: cleanError(error) };
        state.view = "login";
        render();
      }
    });
  } catch (error) {
    state.message = { type: "error", text: cleanError(error) };
    renderFirebaseSetup();
  }
}

function isConfigured() {
  return config.apiKey && !String(config.apiKey).includes("PASTE_");
}

function renderFirebaseSetup() {
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img src="${LOGO_URL}" alt="D&H College">
          <div class="brand-title">
            <strong>SAT Practice Online</strong>
            <span>Firebase setup required</span>
          </div>
        </div>
      </header>
      <main class="main">
        <section class="panel">
          <h1>Connect Firebase First</h1>
          <p class="muted">This online version does not store tests in the browser. Add your Firebase web config to <code>firebase-config.js</code>, publish the Firestore and Storage rules, then upload the folder to GitHub.</p>
          <div class="button-row">
            <a class="btn primary" href="./README.md"><i data-lucide="book-open"></i>Setup guide</a>
            <a class="btn" href="./templates/README-templates.md"><i data-lucide="file-text"></i>Templates</a>
          </div>
        </section>
      </main>
    </div>
  `;
  icons();
}


async function loadPreloadedTests() {
  try {
    const manifestResponse = await fetch(PRELOADED_MANIFEST_URL, { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Preloaded manifest not found.");
    const manifest = await manifestResponse.json();
    const tests = await Promise.all((manifest.tests || []).map(async (item) => {
      const response = await fetch(new URL(item.data, manifestResponse.url).href, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load ${item.data}`);
      const test = await response.json();
      test.source = "preloaded";
      test.status = "active";
      return test;
    }));
    state.preloadedTests = tests.filter((test) => countQuestions(test));
  } catch (error) {
    state.preloadedTests = [];
    console.warn("Preloaded SATs were not loaded:", error);
  }
}

async function getProfile(uid) {
  try {
    const snap = await getDoc(doc(state.db, "users", uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.error("Could not load profile:", error);
    throw error;
  }
}

async function refreshData() {
  if (!state.db || !state.user || !state.profile) {
    state.tests = [];
    state.attempts = [];
    state.users = [];
    return;
  }

  const testsSnap = await getDocs(query(collection(state.db, "tests"), orderBy("createdAt", "desc")));
  const cloudTests = testsSnap.docs.map((item) => ({ id: item.id, source: "firebase", ...item.data() }));
  state.tests = [...state.preloadedTests, ...cloudTests];

  if (state.profile.role === "admin") {
    const [usersSnap, attemptsSnap] = await Promise.all([
      getDocs(query(collection(state.db, "users"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(state.db, "attempts"), orderBy("createdAt", "desc")))
    ]);
    state.users = usersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.attempts = attemptsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } else {
    state.users = [state.profile];
    const attemptsSnap = await getDocs(query(collection(state.db, "attempts"), where("userId", "==", state.user.uid)));
    state.attempts = attemptsSnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => dateMillis(b.completedAt) - dateMillis(a.completedAt));
  }
}

function render() {
  clearTimer();
  if (state.view === "test") return renderTest();
  if (state.view === "score") return renderScore();
  if (state.view === "attemptReview") return renderAttemptReview();

  const authed = Boolean(state.user && state.profile);
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img src="${LOGO_URL}" alt="D&H College">
          <div class="brand-title">
            <strong>SAT Practice Online</strong>
            <span>Shared cloud tests, PDFs, and scores</span>
          </div>
        </div>
        <div class="top-actions">
          ${authed ? `<span class="pill blue">${esc(state.profile.name || state.profile.username)}</span>` : ""}
          ${authed ? `<button class="btn" data-action="logout"><i data-lucide="log-out"></i>Log out</button>` : ""}
        </div>
      </header>
      ${authed ? `<main class="main">${state.profile.role === "admin" ? adminView() : studentView()}</main>` : authView()}
    </div>
  `;
  bind();
  icons();
}

function authView() {
  return `
    <main class="auth-wrap">
      <section class="auth-card">
        <div class="auth-info">
          <img src="${LOGO_URL}" alt="D&H College">
          <h1>Online SAT practice, shared with friends.</h1>
          <p>Accounts, PDFs, tests, grading tables, and scores are stored in Firebase, so the site can run publicly from GitHub Pages.</p>
          <div class="pill-row">
            <span class="pill blue">GitHub Pages</span>
            <span class="pill green">Firebase cloud</span>
            <span class="pill amber">Multiple choice only</span>
          </div>
        </div>
        <div class="auth-panel">
          <div class="tabs">
            ${authTab("login", "Log in")}
            ${authTab("register", "Create account")}
            ${authTab("reset", "Reset password")}
          </div>
          ${state.message ? message(state.message) : ""}
          ${state.authMode === "register" ? registerForm() : state.authMode === "reset" ? resetForm() : loginForm()}
        </div>
      </section>
    </main>
  `;
}

function authTab(mode, label) {
  return `<button class="tab-btn ${state.authMode === mode ? "active" : ""}" data-auth="${mode}">${label}</button>`;
}

function loginForm() {
  return `
    <form class="grid" data-form="login">
      <div class="field"><label>Email</label><input name="loginId" type="email" autocomplete="email" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" required></div>
      <button class="btn primary" type="submit"><i data-lucide="log-in"></i>Log in</button>
      <p class="muted">Use your email to log in. The first account created becomes the admin. After that, new accounts are students.</p>
    </form>
  `;
}

function registerForm() {
  return `
    <form class="grid" data-form="register">
      <div class="form-grid">
        <div class="field"><label>Name</label><input name="name" required></div>
        <div class="field"><label>Username</label><input name="username" required></div>
        <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label>Password</label><input name="password" type="password" minlength="6" required></div>
      </div>
      <button class="btn primary" type="submit"><i data-lucide="user-plus"></i>Create account</button>
    </form>
  `;
}

function resetForm() {
  return `
    <form class="grid" data-form="reset">
      <div class="field"><label>Email</label><input name="loginId" type="email" autocomplete="email" required></div>
      <button class="btn primary" type="submit"><i data-lucide="key-round"></i>Send reset email</button>
      <p class="muted">Enter the email address on your account. Password resets use Firebase Auth email reset links.</p>
    </form>
  `;
}

function studentView() {
  const tests = state.tests.filter((test) => test.status !== "archived");
  const best = state.attempts.length ? Math.max(...state.attempts.map((a) => a.score?.total || 0)) : 0;
  return `
    <section class="view-title">
      <div>
        <h1>Practice Dashboard</h1>
        <p>Start a shared SAT, answer only A-D multiple choice, and submit your score online. Preloaded tests are saved in April 4 - May 24 SATs.</p>
      </div>
    </section>
    <div class="stat-row">
      <div class="stat"><span>Tests</span><strong>${tests.length}</strong></div>
      <div class="stat"><span>Completed</span><strong>${state.attempts.length}</strong></div>
      <div class="stat"><span>Best score</span><strong>${best || "--"}</strong></div>
      <div class="stat"><span>Storage</span><strong>Cloud</strong></div>
    </div>
    <div class="grid two">
      <section class="panel">
        <h2>Available SATs</h2>
        ${tests.length ? `<div class="test-list">${tests.map(studentTestCard).join("")}</div>` : empty("No SATs are online yet.", "Ask the admin to upload one.")}
      </section>
      <section class="panel">
        <h2>Previous Scores</h2>
        ${state.attempts.length ? attemptsTable(state.attempts, false) : empty("No submitted scores yet.", "Your scores will appear here.")}
      </section>
    </div>
  `;
}

function studentTestCard(test) {
  const latest = state.attempts.find((attempt) => attempt.testId === test.id);
  const isPreloaded = test.source === "preloaded";
  return `
    <article class="test-card ${isPreloaded ? "preloaded-card" : ""}">
      <header>
        <div>
          <h3>${esc(test.title)}</h3>
          <p class="muted">${esc(test.folder || "")} - ${countQuestions(test)} multiple-choice questions</p>
        </div>
        <div class="button-row">
          ${test.pdfUrl ? `<a class="btn" href="${esc(test.pdfUrl)}" target="_blank" rel="noreferrer"><i data-lucide="file-text"></i>PDF</a>` : ""}
          <button class="btn primary" data-start="${test.id}"><i data-lucide="play"></i>Start</button>
        </div>
      </header>
      <div class="pill-row">
        ${isPreloaded ? `<span class="pill blue">Preloaded PDF</span>` : `<span class="pill green">Firebase test</span>`}
        ${MODULES.map((m) => `<span class="pill">${m.short}: ${getModule(test, m.key).questions.length}</span>`).join("")}
        ${latest ? `<span class="pill green">Last ${latest.score.total}</span>` : `<span class="pill amber">Not taken</span>`}
      </div>
    </article>
  `;
}

function adminView() {
  return `
    <section class="view-title">
      <div>
        <h1>Admin Console</h1>
        <p>Upload PDFs to Firebase, review questions with the PDF on the right, and see all online scores.</p>
      </div>
    </section>
    ${state.message ? message(state.message) : ""}
    <div class="admin-layout">
      <nav class="side-nav">
        ${adminNav("upload", "Upload SAT", "file-up")}
        ${adminNav("tests", "Saved Tests", "folder")}
        ${adminNav("students", "Students", "users")}
        ${adminNav("scores", "Scores", "bar-chart-3")}
      </nav>
      <section>
        ${state.adminTab === "upload" ? uploadView() : ""}
        ${state.adminTab === "tests" ? testsView() : ""}
        ${state.adminTab === "students" ? studentsView() : ""}
        ${state.adminTab === "scores" ? scoresView() : ""}
      </section>
    </div>
  `;
}

function adminNav(tab, label, icon) {
  return `<button class="btn ${state.adminTab === tab ? "primary" : "ghost"}" data-tab="${tab}"><i data-lucide="${icon}"></i>${label}</button>`;
}

function uploadView() {
  if (state.uploadDraft || state.editDraft) return reviewView(state.editDraft || state.uploadDraft, Boolean(state.editDraft));
  return `
    <section class="panel upload-zone">
      <h2>Upload SAT PDF</h2>
      <p class="muted">The PDF and test are saved online. During review, the original PDF stays on the right side for accuracy checking.</p>
      <form class="grid" data-form="upload">
        <div class="form-grid">
          <div class="field"><label>Test title</label><input name="title" required></div>
          <div class="field"><label>Date folder</label><input name="folder" type="date" value="${today()}" required></div>
          <div class="field full drop-panel"><label>SAT question PDF</label><input name="pdfFile" type="file" accept="application/pdf" required></div>
          <div class="field drop-panel"><label>Answer sheet CSV, JSON, TXT, or PDF</label><input name="answerFile" type="file" accept="application/pdf,text/plain,text/csv,application/json"></div>
          <div class="field"><label>Or paste answer key</label><textarea name="answerText" placeholder="RW1 1 A&#10;RW1 2 C&#10;MATH1 1 D"></textarea></div>
          <div class="field drop-panel"><label>Optional grading system CSV or JSON</label><input name="gradingFile" type="file" accept="text/csv,application/json,text/plain"></div>
          <div class="field"><label>Or paste grading system</label><textarea name="gradingText" placeholder="section,raw,score&#10;rw,0,200&#10;rw,54,800&#10;math,0,200&#10;math,44,800"></textarea></div>
          <div class="field full">
            <label><input type="checkbox" name="ocrMode" value="on"> Use OCR for scanned PDFs</label>
            <p class="muted">OCR is slower. Every extracted question is forced to A-D multiple choice.</p>
          </div>
        </div>
        <button class="btn primary" type="submit"><i data-lucide="wand-sparkles"></i>Extract for review</button>
      </form>
    </section>
  `;
}

function reviewView(test, editing) {
  return `
    <div class="review-layout">
      <section class="module-review">
        <div class="panel">
          <div class="folder-header">
            <div>
              <h2>${editing ? "Edit Online SAT" : "Review Before Upload"}</h2>
              <p class="muted">${esc(test.title)} - ${countQuestions(test)} multiple-choice questions</p>
            </div>
            <div class="button-row">
              <button class="btn" data-action="back-upload"><i data-lucide="arrow-left"></i>Back</button>
              <button class="btn secondary" data-action="auto-balance"><i data-lucide="shuffle"></i>Auto-balance</button>
              <button class="btn primary" data-action="${editing ? "update-test" : "save-test"}"><i data-lucide="cloud-upload"></i>${editing ? "Update online" : "Upload online"}</button>
            </div>
          </div>
        </div>
        ${MODULES.map((m) => moduleEditor(test, m)).join("")}
      </section>
      <aside class="review-tools">
        <section class="panel">
          <h3>Accuracy Check</h3>
          <div class="pill-row">
            <span class="pill green">${countQuestions(test)} questions</span>
            <span class="pill ${missingAnswers(test) ? "amber" : "green"}">${missingAnswers(test)} missing answers</span>
            <span class="pill ${lowConfidence(test) ? "amber" : "green"}">${lowConfidence(test)} low confidence</span>
            <span class="pill ${test.scoring ? "green" : "amber"}">${test.scoring ? "Custom grading" : "Estimated grading"}</span>
          </div>
          <p class="muted">Use the PDF beside this panel to correct any extraction mistakes before saving.</p>
          <button class="btn" data-action="add-question"><i data-lucide="plus"></i>Add question</button>
        </section>
        <section class="panel">
          <h3>Original PDF</h3>
          <div class="pdf-preview">
            ${test.pdfUrl || test.localPdfUrl ? `<iframe src="${esc(test.pdfUrl || test.localPdfUrl)}" title="SAT PDF"></iframe>` : `<div class="empty-state"><p>No PDF preview.</p></div>`}
          </div>
        </section>
      </aside>
    </div>
  `;
}

function moduleEditor(test, module) {
  const mod = getModule(test, module.key);
  return `
    <section class="panel">
      <div class="folder-header">
        <div><h3>${module.title}</h3><p class="muted">${mod.questions.length} multiple-choice questions</p></div>
        <button class="btn small" data-add="${module.key}"><i data-lucide="plus"></i>Add here</button>
      </div>
      <div class="grid">${mod.questions.length ? mod.questions.map((q, i) => questionEditor(q, module.key, i)).join("") : empty("No questions in this module.", "Add or move questions here.")}</div>
    </section>
  `;
}

function questionEditor(q, moduleKey, index) {
  return `
    <article class="question-card" data-q="${q.id}">
      <header>
        <div><h3>Question ${index + 1}</h3><span class="pill ${q.confidence >= 80 ? "green" : "amber"}">Confidence ${Math.round(q.confidence || 0)}%</span></div>
        <div class="button-row">
          <select data-field="moduleKey">${MODULES.map((m) => `<option value="${m.key}" ${m.key === moduleKey ? "selected" : ""}>${m.short}</option>`).join("")}</select>
          <button class="btn small danger" data-delete="${q.id}"><i data-lucide="trash-2"></i>Delete</button>
        </div>
      </header>
      <div class="form-grid">
        <div class="field full"><label>Question text / passage</label><textarea data-field="stem">${esc(q.stem)}</textarea></div>
        <div class="field"><label>Correct answer</label><select data-field="correct">${["", "A", "B", "C", "D"].map((a) => `<option value="${a}" ${q.correct === a ? "selected" : ""}>${a || "Choose"}</option>`).join("")}</select></div>
        <div class="field"><label>Question kind</label><input value="Multiple choice" disabled></div>
        <div class="field full"><label>Choices</label><div class="choice-grid">${["A", "B", "C", "D"].map((a) => `<input data-choice="${a}" value="${esc(q.choices?.[a] || "")}" placeholder="${a}. choice text">`).join("")}</div></div>
      </div>
    </article>
  `;
}

function testsView() {
  const grouped = groupBy(state.tests, (t) => t.folder || "No date");
  const folders = Object.keys(grouped).sort().reverse();
  return `<section class="panel"><h2>Online Tests by Date Folder</h2>${folders.length ? folders.map((folder) => `<article class="test-card"><h3>${esc(folder)}</h3><div class="test-list">${grouped[folder].map(adminTestCard).join("")}</div></article>`).join("") : empty("No tests online.", "Upload the first SAT.")}</section>`;
}

function adminTestCard(test) {
  const isPreloaded = test.source === "preloaded";
  return `
    <article class="test-card ${isPreloaded ? "preloaded-card" : ""}">
      <header>
        <div>
          <h3>${esc(test.title)}</h3>
          <p class="muted">${countQuestions(test)} questions - ${state.attempts.filter((a) => a.testId === test.id).length} scores ${isPreloaded ? "- preloaded in April 4 - May 24 SATs" : ""}</p>
        </div>
        <div class="button-row">
          ${isPreloaded ? `<span class="pill blue">Preloaded</span>` : `<button class="btn small" data-edit="${test.id}"><i data-lucide="pencil"></i>Edit</button>`}
          <a class="btn small" href="${esc(test.pdfUrl || "#")}" target="_blank" rel="noreferrer"><i data-lucide="file"></i>PDF</a>
          ${isPreloaded ? "" : `<button class="btn small danger" data-remove-test="${test.id}"><i data-lucide="trash-2"></i>Delete</button>`}
        </div>
      </header>
      <div class="pill-row">${MODULES.map((m) => `<span class="pill">${m.short}: ${getModule(test, m.key).questions.length}</span>`).join("")}</div>
    </article>
  `;
}

function studentsView() {
  const students = state.users.filter((u) => u.role !== "admin");
  return `<section class="panel"><h2>Students</h2>${students.length ? `<div class="student-list">${students.map(studentCard).join("")}</div>` : empty("No students yet.", "Students can create accounts from the login page.")}</section>`;
}

function studentCard(user) {
  const attempts = state.attempts.filter((a) => a.userId === user.id);
  const best = attempts.length ? Math.max(...attempts.map((a) => a.score.total)) : "--";
  return `<article class="student-card"><h3>${esc(user.name || user.username)}</h3><p class="muted">@${esc(user.username)} - ${esc(user.email)} - best ${best}</p>${attempts.length ? attemptsTable(attempts, true) : ""}</article>`;
}

function scoresView() {
  let attempts = [...state.attempts];
  if (state.sortScores === "score") attempts.sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0));
  else if (state.sortScores === "student") attempts.sort((a, b) => userName(a.userId).localeCompare(userName(b.userId)));
  else attempts.sort((a, b) => dateMillis(b.completedAt) - dateMillis(a.completedAt));
  return `
    <section class="panel">
      <div class="folder-header">
        <div><h2>All Scores</h2><p class="muted">Submitted online attempts from every student.</p></div>
        <div class="segmented">${["date:Newest", "score:Score", "student:Student"].map((item) => {
          const [key, label] = item.split(":");
          return `<button class="segment-btn ${state.sortScores === key ? "active" : ""}" data-sort="${key}">${label}</button>`;
        }).join("")}</div>
      </div>
      ${attempts.length ? attemptsTable(attempts, true) : empty("No scores yet.", "Scores appear after students submit tests.")}
    </section>
  `;
}

function attemptsTable(attempts, includeStudent) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${includeStudent ? "<th>Student</th>" : ""}<th>Test</th><th>Date</th><th>Total</th><th>RW</th><th>Math</th><th>Raw</th><th>Review</th></tr></thead>
        <tbody>${attempts.map((a) => `<tr>${includeStudent ? `<td>${esc(userName(a.userId))}</td>` : ""}<td>${esc(a.testTitle || testTitle(a.testId))}</td><td>${formatDate(a.completedAt)}</td><td><strong>${a.score?.total || "--"}</strong></td><td>${a.score?.rw || "--"}</td><td>${a.score?.math || "--"}</td><td>${a.score?.correct || 0}/${a.score?.totalQuestions || 0}</td><td><button class="btn small" data-review-attempt="${a.id}"><i data-lucide="search"></i>Review</button></td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderTest() {
  const test = state.activeTest;
  const mod = getModule(test, state.activeModule);
  const q = mod.questions[state.activeQuestion];
  if (!q) return submitAttempt();
  const answer = state.activeAttempt.answers[q.id] || "";
  root.innerHTML = `
    <div class="test-shell">
      <header class="exam-topbar">
        <div class="exam-brand"><img src="${LOGO_URL}" alt="D&H College"><div class="exam-title"><strong>${esc(test.title)}</strong><span class="muted">${esc(mod.title)}</span></div></div>
        <div class="timer">${formatTime(state.timerLeft)}</div>
        <div class="exam-actions"><button class="btn ${state.activeAttempt.flags.includes(q.id) ? "warning" : ""}" data-action="flag"><i data-lucide="flag"></i>Flag</button><button class="btn" data-action="formulas"><i data-lucide="calculator"></i>Formulas</button><button class="btn" data-action="exit-test"><i data-lucide="x"></i>Exit</button></div>
      </header>
      <main class="exam-body exam-body-three">
        <section class="stimulus-pane">
          <div class="question-number"><strong>${state.activeQuestion + 1}</strong><div class="annotation-toolbar"><button class="btn small" data-mark="highlight"><i data-lucide="highlighter"></i>Highlight</button><button class="btn small" data-mark="underline"><i data-lucide="underline"></i>Underline</button><button class="btn small" data-mark="clear"><i data-lucide="eraser"></i>Clear</button></div></div>
          <article id="stimulus" class="stimulus-content" contenteditable="true" spellcheck="false">${state.activeAttempt.annotations[q.id] || textHtml(q.stem)}</article>
        </section>
        <section class="answer-pane"><div class="answer-card"><h2>Choose your answer</h2>${choices(q, answer)}</div></section>
        <aside class="pdf-pane"><div class="pdf-mini-header"><strong>Original PDF</strong><a class="btn small" href="${esc(test.pdfUrl || "#")}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i>Open</a></div>${test.pdfUrl ? `<iframe src="${esc(test.pdfUrl)}" title="Original PDF"></iframe>` : empty("No PDF.", "")}</aside>
      </main>
      <footer class="exam-footer">
        <nav class="question-nav">${mod.questions.map((item, i) => `<button class="nav-cell ${i === state.activeQuestion ? "current" : ""} ${state.activeAttempt.answers[item.id] ? "answered" : ""} ${state.activeAttempt.flags.includes(item.id) ? "flagged" : ""}" data-go="${i}">${i + 1}</button>`).join("")}</nav>
        <div class="button-row"><button class="btn" data-action="prev"><i data-lucide="chevron-left"></i>Back</button><button class="btn primary" data-action="next">${isLastQuestion() ? "Next module" : "Next"}<i data-lucide="chevron-right"></i></button><button class="btn warning" data-action="submit"><i data-lucide="send"></i>Submit</button></div>
      </footer>
      ${formulaSheet()}
    </div>
  `;
  bindTest();
  startTimer();
  icons();
}

function choices(q, answer) {
  return `<div class="choice-list">${["A", "B", "C", "D"].map((a) => `<button class="choice-btn ${answer === a ? "active" : ""}" data-answer="${a}"><span class="choice-letter">${a}</span><span>${esc(q.choices?.[a] || `${a}.`)}</span></button>`).join("")}</div>`;
}

function formulaSheet() {
  const items = [["Circle", "Area = pi r^2; circumference = 2 pi r"], ["Triangle", "Area = 1/2 bh; a^2 + b^2 = c^2"], ["Line", "y = mx + b"], ["Quadratic", "x = (-b +/- sqrt(b^2 - 4ac)) / 2a"], ["Slope", "m = (y2 - y1) / (x2 - x1)"], ["Volume", "Cylinder = pi r^2 h"]];
  return `<div class="formula-sheet" id="formula-sheet"><div class="formula-box"><div class="folder-header"><div><h2>SAT Math Formulas</h2><p class="muted">Reference only. Answers are still multiple choice.</p></div><button class="btn" data-action="close-formulas"><i data-lucide="x"></i>Close</button></div><div class="formula-grid">${items.map(([name, f]) => `<div class="formula-item"><strong>${name}</strong><span>${f}</span></div>`).join("")}</div></div></div>`;
}

function renderScore() {
  const a = state.activeAttempt;
  const results = resultsForAttempt(a);
  const wrong = results.filter((r) => r.correctAnswer && !r.isCorrect);
  root.innerHTML = `<div class="app-shell"><header class="topbar"><div class="brand"><img src="${LOGO_URL}" alt="D&H College"><div class="brand-title"><strong>Score Report</strong><span>${esc(a.testTitle || testTitle(a.testId))}</span></div></div><button class="btn primary" data-action="dashboard"><i data-lucide="layout-dashboard"></i>Dashboard</button></header><main class="main"><section class="score-hero"><p class="pill blue">${a.score.scoringMode === "custom" ? "Custom grading" : "Estimated grading"}</p><h1>Your practice score</h1><div class="score-number">${a.score.total}</div><div class="score-breakdown"><div class="stat"><span>Reading and Writing</span><strong>${a.score.rw}</strong></div><div class="stat"><span>Math</span><strong>${a.score.math}</strong></div><div class="stat"><span>Correct</span><strong>${a.score.correct}/${a.score.totalQuestions}</strong></div><div class="stat"><span>Mistakes</span><strong>${wrong.length}</strong></div></div></section>${mistakeReviewSection(results, false)}</main></div>`;
  document.querySelector("[data-action='dashboard']").addEventListener("click", async () => {
    await refreshData();
    state.view = state.profile.role === "admin" ? "admin" : "dashboard";
    render();
  });
  icons();
}

function renderAttemptReview() {
  const a = state.reviewAttempt;
  if (!a) {
    state.view = state.profile.role === "admin" ? "admin" : "dashboard";
    return render();
  }
  const results = resultsForAttempt(a);
  const stats = attemptStats(results);
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><img src="${LOGO_URL}" alt="D&H College"><div class="brand-title"><strong>Attempt Review</strong><span>${esc(a.testTitle || testTitle(a.testId))}</span></div></div>
        <button class="btn primary" data-action="dashboard"><i data-lucide="arrow-left"></i>Back</button>
      </header>
      <main class="main">
        <section class="view-title"><div><h1>${esc(a.testTitle || testTitle(a.testId))}</h1><p>${state.profile.role === "admin" ? `Student: ${esc(userName(a.userId))} - ` : ""}${formatDate(a.completedAt)}</p></div></section>
        <div class="stat-row">
          <div class="stat"><span>Total score</span><strong>${a.score?.total || "--"}</strong></div>
          <div class="stat"><span>Correct</span><strong>${a.score?.correct || 0}/${a.score?.totalQuestions || results.length}</strong></div>
          <div class="stat"><span>Wrong</span><strong>${stats.wrong}</strong></div>
          <div class="stat"><span>Unanswered</span><strong>${stats.unanswered}</strong></div>
        </div>
        ${moduleAnalysis(results)}
        ${mistakeReviewSection(results, true)}
      </main>
    </div>
  `;
  document.querySelector("[data-action='dashboard']").addEventListener("click", async () => {
    state.reviewAttempt = null;
    state.view = state.profile.role === "admin" ? "admin" : "dashboard";
    render();
  });
  icons();
}

function bind() {
  document.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => {
    state.authMode = b.dataset.auth;
    state.message = null;
    render();
  }));
  document.querySelector("[data-action='logout']")?.addEventListener("click", () => signOut(state.auth));
  document.querySelector("[data-form='login']")?.addEventListener("submit", login);
  document.querySelector("[data-form='register']")?.addEventListener("submit", register);
  document.querySelector("[data-form='reset']")?.addEventListener("submit", resetPassword);
  document.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => startTest(b.dataset.start)));
  document.querySelectorAll("[data-review-attempt]").forEach((b) => b.addEventListener("click", () => openAttemptReview(b.dataset.reviewAttempt)));
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    state.adminTab = b.dataset.tab;
    state.message = null;
    state.uploadDraft = null;
    state.editDraft = null;
    render();
  }));
  document.querySelector("[data-form='upload']")?.addEventListener("submit", uploadExtract);
  document.querySelector("[data-action='back-upload']")?.addEventListener("click", () => {
    state.uploadDraft = null;
    state.editDraft = null;
    render();
  });
  document.querySelector("[data-action='save-test']")?.addEventListener("click", saveOnlineTest);
  document.querySelector("[data-action='update-test']")?.addEventListener("click", updateOnlineTest);
  document.querySelector("[data-action='auto-balance']")?.addEventListener("click", autoBalance);
  document.querySelector("[data-action='add-question']")?.addEventListener("click", () => addQuestion("rw1"));
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addQuestion(b.dataset.add)));
  document.querySelectorAll("[data-q]").forEach(bindQuestionEditor);
  document.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteQuestion(b.dataset.delete)));
  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editTest(b.dataset.edit)));
  document.querySelectorAll("[data-remove-test]").forEach((b) => b.addEventListener("click", () => removeTest(b.dataset.removeTest)));
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    state.sortScores = b.dataset.sort;
    render();
  }));
}

function bindTest() {
  document.querySelectorAll("[data-answer]").forEach((b) => b.addEventListener("click", () => {
    saveMarking();
    state.activeAttempt.answers[currentQuestion().id] = b.dataset.answer;
    renderTest();
  }));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
    saveMarking();
    state.activeQuestion = Number(b.dataset.go);
    renderTest();
  }));
  document.querySelector("[data-action='prev']")?.addEventListener("click", () => move(-1));
  document.querySelector("[data-action='next']")?.addEventListener("click", () => move(1));
  document.querySelector("[data-action='submit']")?.addEventListener("click", submitAttempt);
  document.querySelector("[data-action='flag']")?.addEventListener("click", flag);
  document.querySelector("[data-action='exit-test']")?.addEventListener("click", exitTest);
  document.querySelector("[data-action='formulas']")?.addEventListener("click", () => document.querySelector("#formula-sheet").classList.add("open"));
  document.querySelector("[data-action='close-formulas']")?.addEventListener("click", () => document.querySelector("#formula-sheet").classList.remove("open"));
  document.querySelectorAll("[data-mark]").forEach((b) => b.addEventListener("click", () => markText(b.dataset.mark)));
  document.querySelector("#stimulus")?.addEventListener("beforeinput", (e) => {
    if (!e.inputType.startsWith("format")) e.preventDefault();
  });
}

async function login(event) {
  event.preventDefault();
  try {
    const form = new FormData(event.currentTarget);
    const email = String(form.get("loginId")).trim();
    await signInWithEmailAndPassword(state.auth, email, String(form.get("password")));
  } catch (error) {
    state.message = { type: "error", text: cleanError(error) };
    render();
  }
}

async function register(event) {
  event.preventDefault();
  let credential = null;
  let createdProfile = false;
  let createdSettings = false;
  state.creatingAccount = true;

  try {
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const username = String(form.get("username")).trim();
    const usernameLower = username.toLowerCase();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));

    if (!name || !username || !email || !password) throw new Error("Please fill in every account field.");

    // Create Firebase Auth first. Firestore rules require request.auth to exist.
    credential = await createUserWithEmailAndPassword(state.auth, email, password);

    // The first signed-in user becomes admin. Later users become students.
    const settings = await getDoc(doc(state.db, "settings", "app"));
    const role = settings.exists() ? "student" : "admin";

    const profile = {
      name,
      username,
      usernameLower,
      email,
      role,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(state.db, "users", credential.user.uid), profile);
    createdProfile = true;

    if (role === "admin") {
      await setDoc(doc(state.db, "settings", "app"), {
        adminUid: credential.user.uid,
        createdAt: serverTimestamp()
      });
      createdSettings = true;
    }

    state.creatingAccount = false;
    state.profile = { id: credential.user.uid, name, username, usernameLower, email, role };
    state.user = credential.user;
    await refreshData();
    state.view = role === "admin" ? "admin" : "dashboard";
    state.message = null;
    render();
  } catch (error) {
    state.creatingAccount = false;

    // Avoid leaving orphan data if one part of account creation fails.
    if (credential?.user && !state.profile) {
      if (createdSettings) {
        try {
          await deleteDoc(doc(state.db, "settings", "app"));
        } catch (_) {}
      }

      if (createdProfile) {
        try {
          await deleteDoc(doc(state.db, "users", credential.user.uid));
        } catch (_) {}
      }

      try {
        await deleteUser(credential.user);
      } catch (_) {
        try {
          await signOut(state.auth);
        } catch (_) {}
      }
    }

    state.message = { type: "error", text: cleanError(error) };
    render();
  }
}

async function resetPassword(event) {
  event.preventDefault();
  try {
    const email = String(new FormData(event.currentTarget).get("loginId")).trim();
    await sendPasswordResetEmail(state.auth, email);
    state.message = { type: "success", text: "Password reset email sent." };
    render();
  } catch (error) {
    state.message = { type: "error", text: cleanError(error) };
    render();
  }
}

async function uploadExtract(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const pdfFile = form.get("pdfFile");
  const answerFile = form.get("answerFile");
  const gradingFile = form.get("gradingFile");
  const useOcr = form.get("ocrMode") === "on";
  state.message = { text: useOcr ? "Extracting text and running OCR..." : "Extracting PDF text..." };
  render();
  try {
    const pages = await extractPdf(pdfFile, useOcr);
    let answerText = String(form.get("answerText") || "");
    if (answerFile && answerFile.size) answerText += "\n" + await readTextOrPdf(answerFile, useOcr);
    let gradingText = String(form.get("gradingText") || "");
    if (gradingFile && gradingFile.size) gradingText += "\n" + await gradingFile.text();
    state.uploadDraft = buildTest({
      title: String(form.get("title")).trim(),
      folder: String(form.get("folder")) || today(),
      pdfFile,
      pages,
      answers: parseAnswers(answerText),
      scoring: parseScoring(gradingText)
    });
    state.message = { type: "success", text: "Extracted questions. Review them against the PDF on the right." };
    render();
  } catch (error) {
    state.message = { type: "error", text: cleanError(error) };
    render();
  }
}

async function saveOnlineTest() {
  const draft = state.uploadDraft;
  const testRef = doc(collection(state.db, "tests"));
  progress("Uploading PDF to Firebase Storage...");
  const path = `sat-tests/${testRef.id}/${safeName(draft.pdfName || "sat.pdf")}`;
  await uploadBytes(ref(state.storage, path), draft.pdfFile, { contentType: "application/pdf" });
  const pdfUrl = await getDownloadURL(ref(state.storage, path));
  await setDoc(testRef, {
    ...cloudTest(draft),
    pdfPath: path,
    pdfUrl,
    createdBy: state.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  state.uploadDraft = null;
  state.adminTab = "tests";
  state.message = { type: "success", text: "SAT is online now." };
  await refreshData();
  render();
}

async function updateOnlineTest() {
  const test = state.editDraft;
  await updateDoc(doc(state.db, "tests", test.id), { ...cloudTest(test), updatedAt: serverTimestamp() });
  state.editDraft = null;
  state.adminTab = "tests";
  state.message = { type: "success", text: "SAT updated online." };
  await refreshData();
  render();
}

function cloudTest(test) {
  const copy = structuredClone(test);
  delete copy.pdfFile;
  delete copy.localPdfUrl;
  return copy;
}

function bindQuestionEditor(card) {
  const qid = card.dataset.q;
  card.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("input", () => updateQuestion(qid, input.dataset.field, input.value)));
  card.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("change", () => updateQuestion(qid, input.dataset.field, input.value)));
  card.querySelectorAll("[data-choice]").forEach((input) => input.addEventListener("input", () => updateChoice(qid, input.dataset.choice, input.value)));
}

function draft() {
  return state.editDraft || state.uploadDraft;
}

function findQuestion(qid) {
  for (const mod of draft().modules) {
    const index = mod.questions.findIndex((q) => q.id === qid);
    if (index >= 0) return { mod, index, q: mod.questions[index] };
  }
  return null;
}

function updateQuestion(qid, field, value) {
  const found = findQuestion(qid);
  if (!found) return;
  if (field === "moduleKey") {
    found.mod.questions.splice(found.index, 1);
    getModule(draft(), value).questions.push(found.q);
    renumber(draft());
    render();
    return;
  }
  found.q[field] = field === "correct" ? value.toUpperCase() : value;
  found.q.confidence = confidence(found.q);
}

function updateChoice(qid, letter, value) {
  const found = findQuestion(qid);
  if (!found) return;
  found.q.choices[letter] = value;
  found.q.confidence = confidence(found.q);
}

function addQuestion(moduleKey) {
  getModule(draft(), moduleKey).questions.push(newQuestion({ stem: "Paste the question text here." }));
  renumber(draft());
  render();
}

function deleteQuestion(qid) {
  const found = findQuestion(qid);
  if (!found) return;
  found.mod.questions.splice(found.index, 1);
  renumber(draft());
  render();
}

function autoBalance() {
  const test = draft();
  const all = test.modules.flatMap((m) => m.questions);
  test.modules.forEach((m) => (m.questions = []));
  [["rw1", 27], ["rw2", 27], ["math1", 22], ["math2", 22]].reduce((cursor, [key, size]) => {
    getModule(test, key).questions.push(...all.slice(cursor, cursor + size));
    return cursor + size;
  }, 0);
  const used = 98;
  if (all.length > used) getModule(test, "math2").questions.push(...all.slice(used));
  renumber(test);
  render();
}

function editTest(id) {
  state.editDraft = structuredClone(state.tests.find((test) => test.id === id));
  state.adminTab = "upload";
  render();
}

async function removeTest(id) {
  if (!confirm("Delete this online test and its submitted scores?")) return;
  const test = state.tests.find((item) => item.id === id);
  const attempts = await getDocs(query(collection(state.db, "attempts"), where("testId", "==", id)));
  await Promise.all(attempts.docs.map((item) => deleteDoc(doc(state.db, "attempts", item.id))));
  await deleteDoc(doc(state.db, "tests", id));
  if (test?.pdfPath) {
    try {
      await deleteObject(ref(state.storage, test.pdfPath));
    } catch (_) {
      // Ignore missing file.
    }
  }
  await refreshData();
  render();
}

async function startTest(id) {
  state.activeTest = state.tests.find((test) => test.id === id);
  state.activeModule = firstModule(state.activeTest)?.key || "rw1";
  state.activeQuestion = 0;
  state.timerLeft = moduleMeta(state.activeModule).duration * 60;
  state.activeAttempt = {
    testId: id,
    userId: state.user.uid,
    userName: state.profile.name || state.profile.username,
    answers: {},
    flags: [],
    annotations: {},
    startedAt: new Date().toISOString()
  };
  state.view = "test";
  renderTest();
}

function startTimer() {
  clearTimer();
  state.timer = setInterval(() => {
    state.timerLeft -= 1;
    const el = document.querySelector(".timer");
    if (el) el.textContent = formatTime(state.timerLeft);
    if (state.timerLeft <= 0) nextModuleOrSubmit();
  }, 1000);
}

function clearTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function currentQuestion() {
  return getModule(state.activeTest, state.activeModule).questions[state.activeQuestion];
}

function saveMarking() {
  const el = document.querySelector("#stimulus");
  if (el && currentQuestion()) state.activeAttempt.annotations[currentQuestion().id] = el.innerHTML;
}

function move(delta) {
  saveMarking();
  if (delta > 0 && isLastQuestion()) return nextModuleOrSubmit();
  const mod = getModule(state.activeTest, state.activeModule);
  state.activeQuestion = Math.min(Math.max(0, state.activeQuestion + delta), mod.questions.length - 1);
  renderTest();
}

function isLastQuestion() {
  return state.activeQuestion >= getModule(state.activeTest, state.activeModule).questions.length - 1;
}

function nextModuleOrSubmit() {
  saveMarking();
  const mods = state.activeTest.modules.filter((m) => m.questions.length);
  const current = mods.findIndex((m) => m.key === state.activeModule);
  if (current < mods.length - 1) {
    state.activeModule = mods[current + 1].key;
    state.activeQuestion = 0;
    state.timerLeft = moduleMeta(state.activeModule).duration * 60;
    renderTest();
  } else submitAttempt();
}

function flag() {
  const qid = currentQuestion().id;
  state.activeAttempt.flags = state.activeAttempt.flags.includes(qid) ? state.activeAttempt.flags.filter((id) => id !== qid) : [...state.activeAttempt.flags, qid];
  renderTest();
}

function markText(kind) {
  const el = document.querySelector("#stimulus");
  el.focus();
  if (kind === "highlight") document.execCommand("backColor", false, "#fff0a8");
  if (kind === "underline") document.execCommand("underline", false, null);
  if (kind === "clear") el.innerHTML = textHtml(currentQuestion().stem);
  saveMarking();
}

async function submitAttempt() {
  saveMarking();
  clearTimer();
  const results = buildQuestionResults(state.activeTest, state.activeAttempt);
  const attempt = {
    ...state.activeAttempt,
    testTitle: state.activeTest.title,
    testFolder: state.activeTest.folder || "",
    testSource: state.activeTest.source || "firebase",
    questionResults: results,
    score: scoreAttempt(state.activeTest, state.activeAttempt),
    completedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };
  const saved = await addDoc(collection(state.db, "attempts"), attempt);
  state.activeAttempt = { ...state.activeAttempt, id: saved.id, testTitle: attempt.testTitle, testFolder: attempt.testFolder, testSource: attempt.testSource, questionResults: results, score: attempt.score, completedAt: new Date().toISOString() };
  await refreshData();
  state.view = "score";
  renderScore();
}


function openAttemptReview(idValue) {
  const attempt = state.attempts.find((a) => a.id === idValue);
  if (!attempt) return;
  state.reviewAttempt = attempt;
  state.view = "attemptReview";
  render();
}

function findTestById(idValue) {
  return state.tests.find((t) => t.id === idValue) || (state.activeTest?.id === idValue ? state.activeTest : null);
}

function buildQuestionResults(test, attempt) {
  const rows = [];
  test.modules.forEach((mod) => mod.questions.forEach((q, index) => {
    const correctAnswer = String(q.correct || "").toUpperCase();
    const studentAnswer = String(attempt.answers?.[q.id] || "").toUpperCase();
    rows.push({
      moduleKey: mod.key,
      moduleTitle: mod.title,
      moduleShort: mod.short,
      questionNumber: index + 1,
      sourceNumber: q.sourceNumber || q.number || index + 1,
      questionId: q.id,
      stem: q.stem || "",
      choices: q.choices || { A: "", B: "", C: "", D: "" },
      correctAnswer,
      studentAnswer,
      isCorrect: Boolean(correctAnswer && studentAnswer && correctAnswer === studentAnswer),
      flagged: attempt.flags?.includes(q.id) || false
    });
  }));
  return rows;
}

function resultsForAttempt(attempt) {
  if (attempt?.questionResults?.length) return attempt.questionResults;
  const test = findTestById(attempt?.testId);
  if (!test) return [];
  return buildQuestionResults(test, attempt || { answers: {}, flags: [] });
}

function attemptStats(results) {
  const answered = results.filter((r) => r.studentAnswer).length;
  const correct = results.filter((r) => r.correctAnswer && r.isCorrect).length;
  const wrong = results.filter((r) => r.correctAnswer && r.studentAnswer && !r.isCorrect).length;
  const unanswered = results.filter((r) => !r.studentAnswer).length;
  return { answered, correct, wrong, unanswered, total: results.length };
}

function moduleAnalysis(results) {
  const groups = groupBy(results, (r) => r.moduleKey || "unknown");
  const rows = Object.entries(groups).map(([key, items]) => {
    const stats = attemptStats(items);
    const meta = moduleMeta(key);
    const pct = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    return `<tr><td>${esc(meta.short || key)}</td><td>${stats.correct}/${stats.total}</td><td>${stats.wrong}</td><td>${stats.unanswered}</td><td>${pct}%</td></tr>`;
  }).join("");
  return `<section class="panel"><h2>Attempt Analysis by Module</h2><div class="table-wrap"><table><thead><tr><th>Module</th><th>Correct</th><th>Wrong</th><th>Blank</th><th>Accuracy</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function mistakeReviewSection(results, includeCorrect) {
  const mistakes = results.filter((r) => includeCorrect || (r.correctAnswer && !r.isCorrect));
  if (!mistakes.length) return `<section class="panel"><h2>Mistake Review</h2>${empty("No mistakes to review.", "Great work, or this attempt did not save detailed question data.")}</section>`;
  return `
    <section class="panel">
      <h2>${includeCorrect ? "Question-by-Question Review" : "Mistake Review"}</h2>
      <div class="mistake-list">
        ${mistakes.map((r) => `
          <article class="mistake-card ${r.isCorrect ? "correct" : "wrong"}">
            <header>
              <div><h3>${esc(r.moduleShort || r.moduleTitle || r.moduleKey)} - Question ${r.questionNumber}</h3><p class="muted">Source question ${r.sourceNumber || r.questionNumber}</p></div>
              <div class="pill-row"><span class="pill ${r.isCorrect ? "green" : "amber"}">${r.isCorrect ? "Correct" : "Review"}</span>${r.flagged ? `<span class="pill amber">Flagged</span>` : ""}</div>
            </header>
            <p>${textHtml(r.stem)}</p>
            <div class="choice-review">${["A", "B", "C", "D"].map((letter) => `<div class="review-choice ${r.correctAnswer === letter ? "right" : ""} ${r.studentAnswer === letter && r.studentAnswer !== r.correctAnswer ? "picked-wrong" : ""}"><strong>${letter}</strong> ${esc(r.choices?.[letter] || "")}</div>`).join("")}</div>
            <p class="muted">Your answer: <strong>${esc(r.studentAnswer || "Blank")}</strong> | Correct answer: <strong>${esc(r.correctAnswer || "Not provided")}</strong></p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function exitTest() {
  if (!confirm("Exit this test? Nothing is saved until you submit.")) return;
  state.view = "dashboard";
  render();
}

function scoreAttempt(test, attempt) {
  let rwCorrect = 0;
  let rwTotal = 0;
  let mathCorrect = 0;
  let mathTotal = 0;
  test.modules.forEach((mod) => mod.questions.forEach((q) => {
    const correct = String(q.correct || "").toUpperCase();
    const chosen = String(attempt.answers[q.id] || "").toUpperCase();
    if (mod.area === "math") {
      mathTotal += 1;
      if (correct && chosen === correct) mathCorrect += 1;
    } else {
      rwTotal += 1;
      if (correct && chosen === correct) rwCorrect += 1;
    }
  }));
  const rw = scale(rwCorrect, rwTotal, test.scoring?.rw);
  const math = scale(mathCorrect, mathTotal, test.scoring?.math);
  return { rw, math, total: rw + math, correct: rwCorrect + mathCorrect, totalQuestions: rwTotal + mathTotal, scoringMode: test.scoring ? "custom" : "estimated" };
}

function scale(correct, total, map = null) {
  if (!total) return 200;
  if (map && Object.keys(map).length) return lookup(map, correct);
  return clamp(200 + (correct / total) * 600);
}

function lookup(map, raw) {
  const exact = map[String(raw)] ?? map[raw];
  if (exact) return clamp(exact);
  const rows = Object.entries(map).map(([k, v]) => [Number(k), Number(v)]).filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  if (!rows.length) return 200;
  if (raw <= rows[0][0]) return clamp(rows[0][1]);
  if (raw >= rows.at(-1)[0]) return clamp(rows.at(-1)[1]);
  const lo = rows.filter(([k]) => k <= raw).at(-1);
  const hi = rows.find(([k]) => k >= raw);
  return clamp(lo[1] + ((raw - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]));
}

function buildTest({ title, folder, pdfFile, pages, answers, scoring }) {
  const test = {
    title,
    folder,
    status: "active",
    pdfName: pdfFile.name,
    localPdfUrl: URL.createObjectURL(pdfFile),
    pdfFile,
    scoring,
    modules: MODULES.map((m) => ({ ...m, questions: [] }))
  };
  const text = pages.map((page) => `\n[Page ${page.page}]\n${page.text}`).join("\n");
  let global = 0;

  splitModules(text).forEach((chunk) => {
    extractQuestions(chunk.text).forEach((q) => {
      global += 1;
      const moduleKey = chunk.moduleKey || "rw1";
      const moduleNumber = getModule(test, moduleKey).questions.length + 1;
      q.correct = answers.byModule[`${moduleKey}:${q.number}`] || answers.byModule[`${moduleKey}:${moduleNumber}`] || answers.byGlobal[global - 1] || answers.byNumber[q.number] || "";
      q.confidence = confidence(q);
      getModule(test, moduleKey).questions.push(q);
    });
  });

  if (!countQuestions(test)) getModule(test, "rw1").questions.push(newQuestion({ stem: text || "Paste question text here." }));
  renumber(test);
  return test;
}

function splitModules(text) {
  const clean = normalize(text);
  const moduleHeader = /^\s*((?:reading\s*(?:and|&)?\s*writing\s*)?module\s*[12]|rw\s*[12]|math\s*(?:module\s*)?[12])\s*$/gim;
  const hits = [...clean.matchAll(moduleHeader)];
  if (!hits.length) return [{ moduleKey: inferDefaultModule(clean), text: clean }];
  return hits.map((hit, i) => ({
    moduleKey: moduleKeyFromHeader(hit[1], clean),
    text: clean.slice(hit.index + hit[0].length, hits[i + 1]?.index ?? clean.length)
  }));
}

function moduleKeyFromHeader(header, fullText = "") {
  const text = String(header || "").toLowerCase().replace(/\s+/g, " ");
  const num = text.match(/(?:module|rw|math)\s*([12])\b/)?.[1] || "1";
  if (text.includes("math")) return `math${num}`;
  if (text.includes("reading") || text.includes("writing") || /\brw\b/.test(text)) return `rw${num}`;
  const area = inferDefaultArea(fullText);
  return `${area}${num}`;
}

function inferDefaultModule(text) {
  return `${inferDefaultArea(text)}1`;
}

function inferDefaultArea(text) {
  const clean = String(text || "").toLowerCase();
  const mathHits = (clean.match(/\bmath\b|section\s*2|calculator/g) || []).length;
  const rwHits = (clean.match(/\breading\b|\bwriting\b|\brw\b|section\s*1/g) || []).length;
  return mathHits > rwHits ? "math" : "rw";
}

function extractQuestions(text) {
  const clean = stripUploadPdfHeaders(text);
  let starts = [...clean.matchAll(/^\s*Question\s+(\d{1,3})\b/gim)];
  if (!starts.length) starts = [...clean.matchAll(/^\s*(\d{1,3})\s*[\).]\s+/gm)];
  return starts
    .map((hit, i) => parseQuestion(clean.slice(hit.index, starts[i + 1]?.index ?? clean.length), Number(hit[1])))
    .filter((q) => q.stem.length > 10);
}

function parseQuestion(segment, number) {
  let body = normalize(segment)
    .replace(/^\s*Question\s+\d{1,3}\b\s*/i, "")
    .replace(/^\s*\d{1,3}\s*[\).]\s*/i, "");
  body = stripUploadPdfHeaders(body).replace(/[\uFFFE\uFFFD]/g, "\n");

  const firstChoice = body.search(/(?:^|\n)\s*A\s*[\).]\s+/i);
  const choices = { A: "", B: "", C: "", D: "" };

  if (firstChoice < 0) {
    return newQuestion({ number, sourceNumber: number, stem: body, choices });
  }

  const stem = normalize(body.slice(0, firstChoice));
  const options = body.slice(firstChoice);
  const labels = choiceLabels(options);

  labels.forEach((label, index) => {
    const end = labels[index + 1]?.start ?? options.length;
    choices[label.letter] = normalize(options.slice(label.end, end));
  });

  return newQuestion({ number, sourceNumber: number, stem, choices });
}

function choiceLabels(options) {
  const lineLabels = [...options.matchAll(/(?:^|\n)\s*([A-D])\s*[\).]\s+/gi)].map((match) => ({
    letter: match[1].toUpperCase(),
    start: match.index,
    end: match.index + match[0].length
  }));
  if (lineLabels.length >= 4) return lineLabels;

  const ordered = [];
  const expected = ["A", "B", "C", "D"];
  for (const match of options.matchAll(/(?:^|\s)([A-D])\s*[\).]\s+/gi)) {
    const letter = match[1].toUpperCase();
    if (letter === expected[ordered.length]) {
      ordered.push({ letter, start: match.index, end: match.index + match[0].length });
      if (ordered.length === 4) break;
    }
  }
  return ordered.length >= 2 ? ordered : lineLabels;
}

function stripUploadPdfHeaders(text) {
  return normalize(String(text || "")
    .replace(/[\uFFFE\uFFFD]/g, "\n")
    .split("\n")
    .filter((line) => {
      const clean = line.trim();
      if (!clean) return true;
      if (/^(?:Page\s+\d+|\[Page\s+\d+\])$/i.test(clean)) return false;
      if (/^SAT\s+Reading\s+and\s+Writing\s+-\s+CSV\s+to\s+PDF(?:\s+Page\s+\d+)?$/i.test(clean)) return false;
      if (/^SAT\s+(?:Reading\s+and\s+Writing|Math)\s+Questions$/i.test(clean)) return false;
      if (/^Converted\s+from\s+CSV\s*\|/i.test(clean)) return false;
      if (/^Source\s+PDF\s+page\s*:\s*\d+\s*$/i.test(clean)) return false;
      return true;
    })
    .join("\n"));
}

function newQuestion(overrides = {}) {
  const choices = overrides.choices || {};
  return {
    id: id("q"),
    number: overrides.number || 1,
    sourceNumber: overrides.sourceNumber || overrides.number || 1,
    stem: overrides.stem || "",
    choices: { A: choices.A || "", B: choices.B || "", C: choices.C || "", D: choices.D || "" },
    correct: overrides.correct || "",
    confidence: 0
  };
}

function confidence(q) {
  let score = 10;
  if (q.stem.length > 35) score += 35;
  if (["A", "B", "C", "D"].every((a) => q.choices?.[a])) score += 35;
  if (/^[A-D]$/.test(q.correct)) score += 20;
  return Math.min(100, score);
}

function parseAnswers(text) {
  const out = { byModule: {}, byNumber: {}, byGlobal: [] };
  const clean = normalize(text);
  if (!clean) return out;
  try {
    const json = JSON.parse(clean);
    if (Array.isArray(json.answers)) json.answers.forEach((row, i) => addAnswer(out, row.module, row.question || row.number || i + 1, row.answer));
    return out;
  } catch (_) {}
  clean.split(/\n+/).forEach((line) => {
    if (/module\s*,\s*question\s*,\s*answer/i.test(line)) return;
    const csv = line.split(/[,|\t]/).map((x) => x.trim()).filter(Boolean);
    if (csv.length >= 3 && detectModule(csv[0])) return addAnswer(out, csv[0], Number(csv[1]), csv[2]);
    const moduleKey = detectModule(line);
    const lineText = moduleKey ? stripModule(line) : line;
    const matches = [...lineText.matchAll(/(?:^|[\s,;|])(\d{1,2})(?:\s*[\).:-]\s*|\s+)([A-D])(?=\b|[\s,;|]|$)/gi)];
    matches.forEach((m) => addAnswer(out, moduleKey, Number(m[1]), m[2]));
  });
  return out;
}

function addAnswer(out, moduleName, number, answer) {
  const moduleKey = detectModule(moduleName || "");
  const clean = String(answer || "").trim().toUpperCase().replace(/[^A-D]/g, "");
  if (!clean) return;
  if (moduleKey) out.byModule[`${moduleKey}:${number}`] = clean;
  out.byNumber[number] = clean;
  out.byGlobal.push(clean);
}

function parseScoring(text) {
  const clean = normalize(text);
  if (!clean) return null;
  try {
    const json = JSON.parse(clean);
    return { name: json.name || "Custom grading", rw: scoreMap(json.rw), math: scoreMap(json.math) };
  } catch (_) {}
  const scoring = { name: "Custom grading", rw: {}, math: {} };
  clean.split(/\n+/).forEach((line) => {
    if (/^\s*(section|area)\s*,/i.test(line)) return;
    const [section, raw, score] = line.split(/[,|\t]/).map((x) => x.trim());
    const key = sectionKey(section);
    if (key && Number.isFinite(Number(raw)) && Number.isFinite(Number(score))) scoring[key][Number(raw)] = clamp(Number(score));
  });
  return Object.keys(scoring.rw).length || Object.keys(scoring.math).length ? scoring : null;
}

function scoreMap(obj = {}) {
  const out = {};
  Object.entries(obj || {}).forEach(([raw, score]) => {
    if (Number.isFinite(Number(raw)) && Number.isFinite(Number(score))) out[Number(raw)] = clamp(Number(score));
  });
  return out;
}

async function extractPdf(file, useOcr) {
  await ensurePdf();
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const worker = useOcr ? await makeOcrWorker() : null;
  const pages = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    progress(`Reading page ${pageNo} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    let text = pdfLines(content.items);
    if (useOcr && text.replace(/\s/g, "").length < 80) text = await ocrPage(page, worker, pageNo, pdf.numPages);
    pages.push({ page: pageNo, text });
  }
  if (worker) await worker.terminate();
  return pages;
}

async function readTextOrPdf(file, useOcr) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pages = await extractPdf(file, useOcr);
    return pages.map((p) => p.text).join("\n");
  }
  return file.text();
}

async function ensurePdf() {
  if (!window.pdfjsLib) await loadScript("./vendor/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
}

async function makeOcrWorker() {
  if (!window.Tesseract) await loadScript("./vendor/tesseract/tesseract.min.js");
  return window.Tesseract.createWorker("eng", 1, {
    workerPath: "./vendor/tesseract/worker.min.js",
    corePath: "./vendor/tesseract/tesseract-core.wasm.js",
    langPath: "./vendor/tesseract",
    gzip: true,
    logger: (m) => m.status && progress(`OCR ${m.status}: ${Math.round((m.progress || 0) * 100)}%`)
  });
}

async function ocrPage(page, worker, pageNo, total) {
  progress(`OCR page ${pageNo} of ${total}...`);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
  const result = await worker.recognize(canvas);
  return normalize(result.data.text);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function pdfLines(items) {
  const rows = new Map();
  items.forEach((item) => {
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: item.transform[4], text: item.str });
  });
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(" ").trim()).filter(Boolean).join("\n");
}

function progress(text) {
  const el = document.querySelector(".message");
  if (el) el.textContent = text;
}

function getModule(test, key) {
  let mod = test.modules.find((m) => m.key === key);
  if (!mod) {
    mod = { ...MODULES.find((m) => m.key === key), questions: [] };
    test.modules.push(mod);
  }
  return mod;
}

function moduleMeta(key) {
  return MODULES.find((m) => m.key === key) || MODULES[0];
}

function firstModule(test) {
  return test.modules.find((m) => m.questions.length);
}

function countQuestions(test) {
  return test.modules.reduce((sum, m) => sum + m.questions.length, 0);
}

function missingAnswers(test) {
  return test.modules.flatMap((m) => m.questions).filter((q) => !q.correct).length;
}

function lowConfidence(test) {
  return test.modules.flatMap((m) => m.questions).filter((q) => (q.confidence || 0) < 70).length;
}

function renumber(test) {
  test.modules.forEach((m) => m.questions.forEach((q, i) => {
    q.number = i + 1;
    q.confidence = confidence(q);
  }));
}

function detectModule(value = "") {
  const text = String(value).toLowerCase().replace(/\s+/g, " ");
  const compact = text.replace(/[^a-z0-9]/g, "");
  if (/\bmath\s*(module\s*)?2\b/.test(text) || compact.includes("math2")) return "math2";
  if (/\bmath\s*(module\s*)?1\b/.test(text) || compact.includes("math1")) return "math1";
  if (/\brw\s*2\b/.test(text) || /reading.*writing.*2/.test(text) || compact.includes("rw2")) return "rw2";
  if (/\brw\s*1\b/.test(text) || /reading.*writing.*1/.test(text) || compact.includes("rw1")) return "rw1";
  return "";
}

function stripModule(line) {
  return String(line).replace(/\brw\s*[12]\b/i, " ").replace(/\bmath\s*(module\s*)?[12]\b/i, " ").replace(/\breading.*writing\s*(module\s*)?[12]\b/i, " ");
}

function sectionKey(value = "") {
  const text = String(value).toLowerCase();
  if (text.includes("math")) return "math";
  if (text.includes("rw") || text.includes("reading") || text.includes("writing")) return "rw";
  return "";
}

function clamp(score) {
  return Math.max(200, Math.min(800, Math.round(score / 10) * 10));
}

function userName(idValue) {
  const user = state.users.find((u) => u.id === idValue);
  return user?.name || user?.username || "Unknown";
}

function testTitle(idValue) {
  return state.tests.find((t) => t.id === idValue)?.title || state.activeTest?.title || "Unknown test";
}

function dateMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return new Date(value).getTime();
}

function formatDate(value) {
  const ms = dateMillis(value);
  return ms ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms)) : "Not finished";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function safeName(name) {
  return String(name).replace(/[^a-z0-9.\-_]/gi, "-").slice(0, 120) || "sat.pdf";
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalize(value = "") {
  return String(value).replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function textHtml(value = "") {
  return esc(value).replace(/\n/g, "<br>");
}

function groupBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function message(item) {
  return item?.text ? `<div class="message ${item.type || ""}">${esc(item.text)}</div>` : "";
}

function empty(title, detail) {
  return `<div class="empty-state"><div><h3>${esc(title)}</h3><p>${esc(detail)}</p></div></div>`;
}

function cleanError(error) {
  const text = String(error?.message || error)
    .replace(/^Firebase:\s*/i, "")
    .replace(/\s*\(auth\/.*?\)\.?$/i, "")
    .replace("Error: ", "");

  if (/missing or insufficient permissions/i.test(text)) {
    return "Missing or insufficient permissions. Check that firestore.rules were published in Cloud Firestore Rules and storage.rules were published in Storage Rules. Do not paste them into Realtime Database Rules.";
  }

  if (/auth\/email-already-in-use/i.test(String(error?.message || error)) || /email.*already.*use/i.test(text)) {
    return "That email is already in use. Delete the failed user in Firebase Authentication or log in with that email.";
  }

  return text;
}

function icons() {
  if (window.lucide) window.lucide.createIcons();
}
