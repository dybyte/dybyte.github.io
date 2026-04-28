(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var btn = document.createElement('button');
    btn.className = 'ux-back-to-top';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', '맨 위로 이동');
    btn.innerHTML = '↑';
    document.body.appendChild(btn);

    function toggleBtn() {
      if (window.scrollY > 320) {
        btn.classList.add('is-visible');
      } else {
        btn.classList.remove('is-visible');
      }
    }

    window.addEventListener('scroll', toggleBtn, { passive: true });
    toggleBtn();

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.addEventListener('keydown', function (event) {
      var isMetaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      var slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      var active = document.activeElement;
      var inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

      if (inInput) return;
      if (!isMetaK && !slash) return;

      event.preventDefault();
      var searchInput = document.querySelector('.search-input, input[type="search"], #search');

      if (searchInput) {
        searchInput.focus();
        return;
      }

      window.location.href = '/search/';
    });
  });
})();
