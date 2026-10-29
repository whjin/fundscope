/**
 * FundScope 登录模块（localStorage 模拟）
 * 提供 Sign In / Create Account 演示登录态，不涉及真实后端。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'fundscope_user';

  function getStoredUser() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setStoredUser(user) {
    try {
      if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function showMsg(text, isError) {
    var el = document.getElementById('authMessage');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#ef4444' : '#22c55e';
  }

  var isSignup = false;
  var form = document.getElementById('loginForm');
  var emailInput = document.getElementById('authEmail');
  var passwordInput = document.getElementById('authPassword');
  var loginBtn = document.getElementById('loginBtn');
  var toggleBtn = document.getElementById('toggleMode');
  var title = document.getElementById('authTitle');
  var googleBtn = document.getElementById('googleBtn');
  var githubBtn = document.getElementById('githubBtn');

  // 已登录则直接跳转功能页
  var existing = getStoredUser();
  if (existing && existing.email) {
    window.location.href = 'analyze.html';
    return;
  }

  function switchMode() {
    isSignup = !isSignup;
    if (isSignup) {
      title.textContent = '创建你的 FundScope 账户';
      loginBtn.textContent = 'Create Account';
      toggleBtn.textContent = '已有账户？Sign In';
    } else {
      title.textContent = '登录你的 FundScope 账户';
      loginBtn.textContent = 'Sign In';
      toggleBtn.textContent = '没有账户？Create Account';
    }
    showMsg('');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = (emailInput.value || '').trim();
    var password = passwordInput.value || '';

    if (!email || !email.includes('@')) {
      showMsg('请输入有效的邮箱地址。', true);
      return;
    }
    if (password.length < 6) {
      showMsg('密码至少 6 位。', true);
      return;
    }

    if (isSignup) {
      setStoredUser({ email: email, name: email.split('@')[0], createdAt: Date.now() });
      showMsg('🎉 账户创建成功！正在进入...');
    } else {
      setStoredUser({ email: email, name: email.split('@')[0], lastLoginAt: Date.now() });
      showMsg('✅ 登录成功！正在进入...');
    }

    setTimeout(function () {
      window.location.href = 'analyze.html';
    }, 600);
  });

  toggleBtn.addEventListener('click', switchMode);

  // 第三方登录：模拟演示
  function oauth(method) {
    setStoredUser({ email: method.toLowerCase() + '_demo@fundscope.local', name: method, via: method, createdAt: Date.now() });
    showMsg('已通过 ' + method + ' 演示登录，正在进入...');
    setTimeout(function () {
      window.location.href = 'analyze.html';
    }, 600);
  }
  googleBtn.addEventListener('click', function () { oauth('Google'); });
  githubBtn.addEventListener('click', function () { oauth('GitHub'); });
})();
