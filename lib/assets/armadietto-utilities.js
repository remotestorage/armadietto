/* eslint-env browser */

// function to set a given theme/color-scheme
function setTheme (themeName) {
  localStorage.setItem('theme', themeName);
  document.documentElement.setAttribute('data-theme', themeName);
  document.getElementById('switch').setAttribute('class', themeName);
}

// function to toggle between light and dark theme
function toggleTheme () {
  localStorage.getItem('theme') === 'dark' ? setTheme('light') : setTheme('dark');
}

// Immediately invoked function to set the theme on initial load
(function () {
  localStorage.getItem('theme') === 'dark' ? setTheme('dark') : setTheme('light');
})();

document.getElementById('switch').addEventListener('click', toggleTheme);

const togglePassword = document.querySelector('#togglePassword');
const password = document.querySelector('#password');

if (togglePassword) {
  togglePassword.addEventListener('click', function () {
    // toggle the type attribute
    const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
    password.setAttribute('type', type);

    // toggle the icon
    this.classList.toggle('icon-slash');
  });
}
