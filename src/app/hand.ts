import { Component, computed, input, linkedSignal } from '@angular/core';

// يعرض صورة اليد من public/signs/<id>.png، وإذا ما لقاها يعرض الحرف باهت
@Component({
  selector: 'app-hand',
  template: `
    @for (k of keys(); track k) {
      @if (!failed()) {
        <img [src]="'signs/' + id() + '.png'" [alt]="alt()" draggable="false" (error)="failed.set(true)" />
      } @else {
        <span class="ph" aria-hidden="true">{{ ch() }}</span>
      }
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; justify-content: center; }
    img { height: var(--h, 160px); width: auto; max-width: 100%; object-fit: contain; -webkit-user-drag: none; user-select: none;
          animation: pop .38s cubic-bezier(.34, 1.56, .64, 1); }
    .ph { font-size: calc(var(--h, 160px) * .5); font-weight: 800; color: rgba(var(--blue-rgb, 26, 47, 143), .14); }
    @keyframes pop { from { opacity: 0; transform: scale(.86) rotate(-5deg); } }
    @media (prefers-reduced-motion: reduce) { img { animation: none; } }
  `,
})
export class Hand {
  id = input.required<string>();
  ch = input('');
  decor = input(false);                                   // true = صورة تزيينية بدون وصف
  keys = computed(() => [this.id()]);                     // يعيد إنشاء الصورة عند تغيّر الحرف فتتحرك
  alt = computed(() => (this.decor() ? '' : 'إشارة حرف ' + this.ch()));
  failed = linkedSignal(() => { this.id(); return false; });
}