/**
 * FundScope 登录/注册（演示入口）
 * 不做真实鉴权，不写 localStorage；表单校验通过即进入 analyze.html。
 */
(function () {
  'use strict';

  function showMsg(text, isError) {
    var el = document.getElementById('authMessage');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#ef4444' : '#22c55e';
  }

  function goApp() {
    window.location.href = 'analyze.html';
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

    showMsg(isSignup ? '🎉 账户创建成功，正在进入...' : '✅ 登录成功，正在进入...');
    setTimeout(goApp, 500);
  });

  toggleBtn.addEventListener('click', switchMode);

  googleBtn.addEventListener('click', function () {
    showMsg('正在通过 Google 进入...');
    setTimeout(goApp, 500);
  });
  githubBtn.addEventListener('click', function () {
    showMsg('正在通过 GitHub 进入...');
    setTimeout(goApp, 500);
  });
})();
