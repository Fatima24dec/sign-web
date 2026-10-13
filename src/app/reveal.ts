import { Directive, ElementRef, Input, OnChanges, OnDestroy, afterNextRender } from '@angular/core';

type Flag = boolean | '';

/** ظهور تدريجي عند السكرول (IntersectionObserver + CSS فقط، بدون مكتبات ولا scroll-jacking).
 *  <div [appReveal]="200">            fade + حركة خفيفة لفوق، بتأخير 200ms
 *  <h2  appReveal words>              العنوان يظهر كلمة كلمة
 *  <p   appReveal chunks>             الفقرة تظهر مجموعات صغيرة (٤ كلمات تقريباً)
 *  <div appReveal mask>               كشف بقناع (clip-path) للكروت
 *  [when]="cond"                      ما يبدأ إلا إذا cond صحيحة
 *  - يظهر مرة وحدة فقط ولا يتكرر لو رجعت لفوق.
 *  - لو الحركة معطّلة بالنظام أو IntersectionObserver مو موجود: العنصر يبقى ظاهر.
 *  - العنصر ما ينخفي إلا بعد ما الكود يجهّز نفسه، ولو الأوبزرفر ما ردّ خلال ٢.٥ ثانية يظهر تلقائياً. */
@Directive({
  selector: '[appReveal]',
  host: { '[style.--d]': 'd' },
})
export class Reveal implements OnChanges, OnDestroy {
  @Input('appReveal') delay: number | string = 0;
  @Input() words: Flag = false;
  @Input() chunks: Flag = false;
  @Input() mask: Flag = false;
  @Input() when = true;
  get d(): string { return (Number(this.delay) || 0) + 'ms'; }

  private io?: IntersectionObserver;
  private vis = false;
  private shown = false;
  private ready = false;
  private fired = false;
  private fallback?: ReturnType<typeof setTimeout>;

  constructor(private el: ElementRef<HTMLElement>) {
    afterNextRender(() => {
      const node = this.el.nativeElement;
      const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || typeof IntersectionObserver === 'undefined') return;     // يبقى ظاهر بدون حركة
      try {
        const text = this.words !== false || this.chunks !== false;
        if (text) this.prepareText(node, this.chunks !== false ? 4 : 1);
        node.classList.add('rv-init', text ? 'rv-text' : this.mask !== false ? 'rv-mask' : 'rv-fade');
        void node.offsetWidth;                                               // يثبّت الحالة الأولى قبل الأنيميشن
        this.io = new IntersectionObserver((es) => {
          this.fired = true;
          this.vis = es[es.length - 1].isIntersecting;
          this.update();
        }, { threshold: 0 });
        this.io.observe(node);
        this.fallback = setTimeout(() => { if (!this.fired) { this.vis = true; this.update(); } }, 2500);
        this.ready = true;
      } catch {
        node.classList.remove('rv-init', 'rv-text', 'rv-mask', 'rv-fade');   // لو صار خطأ: يبقى ظاهر
      }
    });
  }

  ngOnChanges(): void { if (this.ready) this.update(); }
  ngOnDestroy(): void { this.io?.disconnect(); clearTimeout(this.fallback); }

  /** مرة وحدة فقط: بعد ما يظهر نوقف الأوبزرفر ولا نرجّعه ينخفي (حتى لو طلع من الشاشة) */
  private update(): void {
    if (this.shown || !(this.vis && this.when)) return;
    this.shown = true;
    this.el.nativeElement.classList.add('in');
    this.io?.disconnect();
    clearTimeout(this.fallback);
  }

  /** يجهّز وحدات النص: كلمات (أو مجموعات كلمات) كل وحدة لها تأخير بسيط */
  private prepareText(node: HTMLElement, size: number): void {
    let units = Array.from(node.querySelectorAll<HTMLElement>(':scope > .word'));   // لو الكلمات جاهزة بالقالب (جملة الإشارات)
    if (!units.length) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      let t: Node | null;
      while ((t = walker.nextNode())) if ((t as Text).data.trim()) texts.push(t as Text);
      for (const tx of texts) {
        const words = tx.data.split(/\s+/).filter(Boolean);
        const frag = document.createDocumentFragment();
        if (/^\s/.test(tx.data)) frag.append(' ');
        for (let i = 0; i < words.length; i += size) {
          const s = document.createElement('span');
          s.textContent = words.slice(i, i + size).join(' ');
          frag.append(s);
          units.push(s);
          if (i + size < words.length) frag.append(' ');
        }
        if (/\s$/.test(tx.data)) frag.append(' ');
        tx.replaceWith(frag);
      }
    }
    const step = Math.min(70, 480 / Math.max(units.length, 1));
    units.forEach((u, i) => { u.classList.add('rw'); u.style.setProperty('--wd', Math.round(i * step) + 'ms'); });
  }
}