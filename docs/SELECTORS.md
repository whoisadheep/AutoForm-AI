# Google Forms DOM Selector Dictionary

Google Forms uses a compiled component architecture (Google Closure/Wiz framework). Class names are obfuscated and can change between builds or A/B tests. This extension uses **ARIA-first selectors** with class-name fallbacks for resilience.

> **Last verified:** August 2026

---

## 1. Selectors Matrix

| Component | Primary Selector (Stable) | Fallback Selector (Obfuscated) | Notes |
|:---|:---|:---|:---|
| **Question Container** | `div[role="listitem"]` | `.Qr7Oae` | Top-level block wrapping each form question. |
| **Question Title** | `[role="heading"] span` | `.M7eMe` | Contains the question prompt text. |
| **Option Label** | `label` | — | Wraps each radio/checkbox option row. |
| **Option Text** | `data-value` attr on `[role="radio/checkbox"]`, then `span[dir="auto"]` | `span.aDTYNe`, `span.snByac`, legacy `span.aDTYNe.snByac.kTYmRb.OIC90c` | **Never rely on the 4-class chain alone** — it breaks across themes. |
| **Radio Button** | `[role="radio"]` + `aria-checked` | `input[type="radio"]` (NOT present on most forms) | Google Forms uses custom ARIA widgets, not native inputs. |
| **Checkbox** | `[role="checkbox"]` + `aria-checked` | `input[type="checkbox"]` (NOT present on most forms) | Same — custom ARIA widgets. |
| **Short Text Input** | `input[type="text"]` | `input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])` | Native `<input>` elements — still used by Google Forms. |
| **Paragraph Input** | `textarea` | — | Native `<textarea>` — still used. |

---

## 2. Selector Resolution Strategy

The content script (`src/content/content.js`) uses a tiered resolution approach:

### Question Containers
```javascript
// Try obfuscated class first (fastest), fall back to ARIA role
function getQuestionBlocks() {
    const blocks = document.querySelectorAll('.Qr7Oae');
    if (blocks.length > 0) return blocks;
    return document.querySelectorAll('div[role="listitem"]');
}
```

### Question Titles
```javascript
// Obfuscated class → ARIA heading role → heading container
const el = block.querySelector('.M7eMe') ||
           block.querySelector('[role="heading"] span') ||
           block.querySelector('div[role="heading"]');
```

### Option Text Extraction
```javascript
// 1. data-value attribute on ARIA widget (most reliable)
// 2. span[dir="auto"] (semantic, stable)
// 3. span.aDTYNe or span.snByac (single-class, resilient)
// 4. Legacy 4-class chain (last resort)
// 5. Any span inside the label (final fallback)
```

---

## 3. Critical: Google Forms Does NOT Use Native Radio/Checkbox Inputs

Google Forms renders **custom ARIA widgets** instead of native `<input type="radio/checkbox">`:

```html
<!-- What Google Forms actually renders: -->
<div role="radio" aria-checked="false" data-value="Option A" tabindex="0">
<div role="checkbox" aria-checked="false" data-value="Option B" tabindex="0">

<!-- NOT this (legacy assumption): -->
<input type="radio" name="entry.123" value="Option A">
```

### Checking Selection State
```javascript
// Correct (ARIA widgets):
widget.getAttribute('aria-checked') === 'true'

// Incorrect (won't match — native inputs don't exist):
input.checked
```

---

## 4. Event Simulation Strategy

Google Forms relies on synthetic client-side event listeners (`jsaction`). Simply modifying `input.value` is insufficient.

### For Text Fields:
```javascript
input.focus();
input.value = answerText;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
input.dispatchEvent(new Event('blur', { bubbles: true }));
```

### For Radio Buttons / Checkboxes (ARIA Widgets):
```javascript
// Try direct click first, then synthetic mouse events:
widget.click();
// or:
target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
```

---

## 5. String Normalization for Option Matching

When matching AI-generated answers against DOM labels:
```javascript
const normalize = (text) => text.toLowerCase().replace(/\s+/g, '').replace(/[^\w]|_/g, '');
```
1. Perform exact normalized match first.
2. If no exact match, fallback to substring/containment search.
3. Final fallback: match against `data-value` attributes on ARIA widgets directly.
