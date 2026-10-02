// The Calculator's markup inside a VOIDEX window: index.html of the original
// app without the standalone page chrome (fake OS bar, clock, page footer and
// bottom label; VOIDEX draws the window and its title bar). Element ids carry
// the "vxc-" prefix so they never clash with the rest of the OS document.
const icon = {
  camera: '<svg viewBox="0 0 24 24"><path d="M8 6l2-3h4l2 3h4v14H4V6z"/><circle cx="12" cy="13" r="4"/></svg>',
  gallery: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="M3 17l6-6 4 4 3-3 5 5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="13" rx="3"/><path d="M15 8V4H4v13h4"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
};

export const markup = `
<div class="vxc-workspace">
  <section class="calculator" id="vxc-calculator" aria-label="Калькулятор">
    <div class="display">
      <div class="display-top"><span id="vxc-modeLabel">ОБЫЧНЫЙ РЕЖИМ</span><button id="vxc-backspace" aria-label="Удалить символ" class="small-button">⌫</button></div>
      <label class="sr-only" for="vxc-expression">Выражение или уравнение</label>
      <textarea id="vxc-expression" rows="1" spellcheck="false" placeholder="0" autocomplete="off" data-testid="calc-expression">1250 × 4</textarea>
      <div id="vxc-mathPreview" class="math-preview" aria-label="Формула"></div>
      <output id="vxc-answer" class="answer" aria-live="polite" data-testid="calc-answer">5 000</output>
      <div id="vxc-answerDetail" class="answer-detail" data-testid="calc-answer-detail"></div>
    </div>
    <div class="mode-switch" role="tablist" aria-label="Режим калькулятора">
      <button id="vxc-basicMode" role="tab" aria-selected="true" class="selected" data-testid="calc-mode-basic">Обычный</button>
      <button id="vxc-scienceMode" role="tab" aria-selected="false" data-testid="calc-mode-science">Научный</button>
    </div>
    <div id="vxc-scientificTools" class="scientific-tools" hidden>
      <div class="science-heading">
        <span class="science-label">Функции</span>
        <span class="pad-tabs" role="tablist" aria-label="Клавиатура">
          <button id="vxc-padFunctions" role="tab" class="selected" data-testid="calc-pad-functions">f(x)</button>
          <button id="vxc-padDigits" role="tab" data-testid="calc-pad-digits">123</button>
        </span>
        <span class="science-heading-actions">
          <button id="vxc-cameraMini" class="mini-photo" aria-label="Камера" title="Камера">${icon.camera}</button>
          <button id="vxc-galleryMini" class="mini-photo" aria-label="Из галереи" title="Из галереи">${icon.gallery}</button>
          <button id="vxc-angleMode" class="angle-button" title="Единицы угла" data-testid="calc-angle">RAD</button>
        </span>
      </div>
      <div class="science-grid" id="vxc-scienceKeys"></div>
    </div>
    <div class="keypad" id="vxc-keypad"></div>
    <div id="vxc-photoActions" class="photo-actions" hidden>
      <button id="vxc-cameraButton" data-testid="calc-camera">${icon.camera}Камера</button>
      <button id="vxc-galleryButton" data-testid="calc-gallery">${icon.gallery}Из галереи</button>
    </div>
    <p class="keyboard-hint" id="vxc-keyboardHint">Enter — вычислить · Esc — очистить</p>
  </section>
  <aside class="solution-pane" id="vxc-solutionPane" data-testid="calc-solution">
    <div class="solution-header">
      <button class="icon-button solution-back" id="vxc-solutionBack" aria-label="Назад к калькулятору" title="Назад к калькулятору" data-testid="calc-solution-back">${icon.back}</button>
      <div class="solution-title"><span class="eyebrow">РАЗБОР</span><h2>Решение по шагам</h2></div>
      <button class="icon-button" id="vxc-copyButton" aria-label="Скопировать решение" title="Скопировать решение">${icon.copy}</button>
    </div>
    <div id="vxc-steps" class="steps" aria-live="polite" data-testid="calc-steps"></div>
    <div class="try-examples">
      <span class="eyebrow">ПОПРОБУЙТЕ</span>
      <div class="examples">
        <button data-example="1/3 + 1/6">Дроби <span>⅓ + ⅙</span></button>
        <button data-example="sqrt(72) + sqrt(8)">Корни <span>√72 + √8</span></button>
        <button data-example="x^2 - 5x + 6 = 0">Уравнение <span>x² − 5x + 6 = 0</span></button>
        <button data-example="sqrt(x+5) = x-1">Сложнее <span>√(x + 5) = x − 1</span></button>
      </div>
    </div>
  </aside>
</div>
<span id="vxc-footerStatus" class="sr-only" aria-live="polite">Обычный режим</span>
<div class="vxc-scrim" id="vxc-scrim"></div>
<dialog id="vxc-photoDialog" data-testid="calc-photo-dialog">
  <div class="dialog-head"><h2>Уравнение с фото</h2><button class="icon-button close-dialog" aria-label="Закрыть">×</button></div>
  <p class="muted">Снимите одно уравнение крупно, ровно и при хорошем освещении.</p>
  <div class="photo-preview"><img id="vxc-photoPreview" alt="Загруженная задача"><canvas id="vxc-cropCanvas" hidden></canvas></div>
  <div class="crop-row"><button id="vxc-cropButton" data-testid="calc-crop">Выделить уравнение</button><button id="vxc-recognizeButton" class="primary" data-testid="calc-recognize">Распознать</button></div>
  <p id="vxc-ocrStatus" role="status" class="muted" data-testid="calc-ocr-status">Фото обрабатывается на вашем устройстве.</p>
  <progress id="vxc-ocrProgress" value="0" max="1" hidden></progress>
  <label for="vxc-ocrText" class="field-label">Проверьте распознанное уравнение</label>
  <textarea id="vxc-ocrText" rows="3" placeholder="Здесь появится распознанный текст" data-testid="calc-ocr-text"></textarea>
  <p class="muted note">Печатный текст распознаётся лучше. Рукописные знаки, степени и многоэтажные дроби могут потребовать исправления.</p>
  <button id="vxc-usePhoto" class="primary full" data-testid="calc-use-photo">Решить уравнение</button>
</dialog>
<dialog id="vxc-historyDialog" data-testid="calc-history">
  <div class="dialog-head"><h2>История</h2><button class="icon-button close-dialog" aria-label="Закрыть">×</button></div>
  <div id="vxc-historyList" class="history-list"></div>
  <p class="muted note">История хранится только до закрытия страницы.</p>
  <button id="vxc-clearHistory" class="secondary full">Очистить историю</button>
</dialog>
<dialog id="vxc-helpDialog" data-testid="calc-help">
  <div class="dialog-head"><h2>Как вводить</h2><button class="icon-button close-dialog" aria-label="Закрыть">×</button></div>
  <p>Введите выражение с клавиатуры или используйте кнопки.</p>
  <dl><dt>Дроби</dt><dd><code>1/3 + 1/6</code> или <code>(x+1)/(x−2)</code></dd><dt>Корни и степени</dt><dd><code>sqrt(72)</code>, <code>cbrt(27)</code>, <code>x^2</code></dd><dt>Функции</dt><dd><code>sin(pi/2)</code>, <code>log(100)</code>, <code>ln(e)</code>, <code>5!</code></dd><dt>Уравнения</dt><dd>Линейные, квадратные, рациональные и полиномы до 6-й степени с одной переменной x. Поддерживается изолированный корень вида <code>sqrt(x+5)=x−1</code>.</dd></dl>
  <p class="muted">Уравнения с несколькими переменными, системами или x внутри тригонометрических функций пока не поддерживаются. Приложение работает в действительных числах.</p>
  <p class="muted">RAD — радианы, DEG — градусы. После распознавания фото обязательно проверьте выражение.</p>
  <p class="muted">Фото распознаётся на вашем устройстве и никуда не отправляется.</p>
</dialog>
<input type="file" accept="image/*" id="vxc-galleryInput" hidden data-testid="calc-gallery-input">
<input type="file" accept="image/*" capture="environment" id="vxc-cameraInput" hidden data-testid="calc-camera-input">
<div id="vxc-toast" class="toast" role="status"></div>
`;
