/**
 * Performance monitoring & global UI helpers.
 * - Periodic heap-usage warnings (performance.memory, Chromium).
 * - Row-count warnings for very large workbooks.
 * - Lightweight mark/measure helpers.
 * - Global toast notifications used by the error boundary.
 */
(function(App) {
    'use strict';

    var Perf = App.Perf || {};

    var warnedHeap = false;
    var warnedRows = false;

    function showToast(message, type) {
        var container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function() {
            toast.classList.add('toast-out');
            setTimeout(function() { toast.remove(); }, 400);
        }, 6000);
    }

    Perf.toast = showToast;

    function showWarning(message) {
        var el = document.getElementById('perf-warning');
        if (!el) return;
        var banner = document.createElement('div');
        banner.className = 'perf-banner';
        banner.innerHTML = '<span>' + message + '</span><button type="button" aria-label="Dismiss warning">Dismiss</button>';
        el.appendChild(banner);
        var btn = banner.querySelector('button');
        if (btn) btn.addEventListener('click', function() { banner.remove(); });
    }

    function checkHeap() {
        if (typeof performance === 'undefined' || !performance.memory) return;
        try {
            var mem = performance.memory;
            if (mem.usedJSHeapSize > mem.jsHeapSizeLimit * 0.8 && !warnedHeap) {
                warnedHeap = true;
                showWarning('Browser memory use is above 80% of its limit. Close other tabs, restart the browser, or work with a smaller workbook for smoother performance.');
            }
        } catch (e) { /* performance.memory is non-standard — ignore */ }
    }

    Perf.warnRowCount = function(totalRows) {
        if (totalRows > 50000 && !warnedRows) {
            warnedRows = true;
            showWarning(totalRows.toLocaleString() + ' rows loaded. Rendering is virtualized, but extremely large workbooks may slow the browser.');
        }
    };

    Perf.mark = function(name) {
        if (window.performance && performance.mark) { try { performance.mark(name); } catch (e) {} }
    };
    Perf.measure = function(name, from) {
        if (window.performance && performance.measure) { try { performance.measure(name, from); } catch (e) {} }
    };
    Perf.log = function(name, ms) {
        if (window.__perfDebug) console.log('[' + name + '] ' + ms + 'ms');
    };

    Perf.init = function() {
        checkHeap();
        if (typeof performance !== 'undefined' && performance.memory) {
            setInterval(checkHeap, 5000);
        }
    };

    App.Perf = Perf;
})(window.PersonallApp);
