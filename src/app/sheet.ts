import { Directive, ElementRef, OnDestroy, afterNextRender } from '@angular/core';

/** انتقال "طبقات" بين السكاشن: السكشن الجديد يطلع فوق السابق بزوايا مدوّرة (مرة وحدة لكل سكشن).
 *  الاستخدام: على <main appSheet>، والعناصر داخله تُعلَّم بكلاسات:
 *   .stk-pin  السكشن السابق: يثبت (sticky) من تحت فيبقى خلف السكشن الجديد.
 *   .stk-over السكشن الجديد: يتداخل فوق السابق (margin سالب بقدر الزاوية)، وزواياه (--cr) تتبع موضعه.
 *  أول مرة:
 *   - أول ما يبان جزء من السكشن الجديد (TRIGGER) وأنت نازل، نكمل الحركة تلقائياً لين يغطي السابق ويستقر.
 *   - ما نقفل السكرول: ما فيه preventDefault. سكرول لفوق/لمس/ماوس/مفتاح يوقف الحركة، وسكرول لتحت أثناءها ما يوقفها.
 *     ولو وقفت بنص الانتقال وبطّلت تسكرول تكمل لين تستقر.
 *  بعد ما يخلص (done): السكشن يصير "مستقر" نهائياً: الزوايا صفر، والسكشن السابق يرجع تدفّق عادي (ينفك التثبيت)،
 *  فلو رجعت لفوق ونزلت ما ترجع أي حركة. الحالة محفوظة لين تحدّث الصفحة.
 *  مع prefers-reduced-motion: ما فيه تداخل ولا حركة.
 *
 *  تعديل الجوال: لما يكون المستخدم يكتب في حقل (input) أو كيبورد الجوال مفتوح:
 *   - ما نشغّل الحركة التلقائية (كانت تنزّل الصفحة للسكشن اللي تحت).
 *   - ما نعيد حساب الأطوال (الكيبورد يغيّر innerHeight). */
const TRIGGER = 0.15;      // نسبة الظاهر من السكشن الجديد اللي تشغّل الانتقال (غيّرها لو تبي أبكر/أخر)
const MAX_SHOW = 0.5;      // أقصى جزء من الشاشة يظهر من السكشن الجديد قبل ما يكمل تلقائياً (0.5 = نص الشاشة، ارفعها لو تبي الأبيض يبقى أطول)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

interface Over { el: HTMLElement; r: number; done: boolean; }

@Directive({ selector: '[appSheet]' })
export class Sheet implements OnDestroy {
  private pins: HTMLElement[] = [];
  private overs: Over[] = [];
  private raf = 0;
  private idleT?: ReturnType<typeof setTimeout>;
  private ro?: ResizeObserver;
  private io?: IntersectionObserver;
  private anim: { raf: number } | null = null;
  private lastY = 0;
  private lastW = 0;
  private dir = 0;              // اتجاه آخر سكرول: 1 لتحت، -1 لفوق
  private touching = false;     // الإصبع على الشاشة: ما نبدأ حركة تلقائية
  private suppress = false;     // أثناء تنقّل النافبار ما نشغّل الحركة التلقائية
  private typingUntil = 0;      // بعد ما تطلع من حقل الكتابة نستنى شوي (الكيبورد يسكّر)

  constructor(private el: ElementRef<HTMLElement>) {
    afterNextRender(() => {
      const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      const root = this.el.nativeElement;
      this.pins = Array.from(root.querySelectorAll<HTMLElement>('.stk-pin'));
      this.overs = Array.from(root.querySelectorAll<HTMLElement>('.stk-over')).map((el) => ({ el, r: 0, done: false }));
      this.lastY = window.scrollY;
      this.lastW = window.innerWidth;

      const p = { passive: true } as const;
      window.addEventListener('scroll', this.onScroll, p);
      window.addEventListener('resize', this.onResize);
      window.addEventListener('stk-nav', this.onNav);
      window.addEventListener('wheel', this.onWheel, p);
      window.addEventListener('touchstart', this.onTouchStart, p);
      window.addEventListener('touchend', this.onTouchEnd, p);
      window.addEventListener('touchcancel', this.onTouchEnd, p);
      window.addEventListener('mousedown', this.onUser, p);
      window.addEventListener('keydown', this.onUser, p);
      window.addEventListener('focusout', this.onFocusOut);

      this.ro = new ResizeObserver(this.onResize);                 // يعيد الحساب لما يتغير ارتفاع السكشن (صور، خطوط، تغليف)
      this.pins.forEach((el) => this.ro!.observe(el));
      (document as any).fonts?.ready?.then(this.onResize);

      if (typeof IntersectionObserver !== 'undefined') {
        this.io = new IntersectionObserver((es) => {
          for (const e of es) {
            if (!e.isIntersecting) continue;
            const o = this.overs.find((x) => x.el === e.target);
            if (o && !o.done && this.zone(o, o.el.getBoundingClientRect().top)) this.start(o);
          }
        }, { threshold: [TRIGGER] });
        this.overs.forEach((o) => this.io!.observe(o.el));
      }
      this.measure();
      this.paint();
    });
  }

  /** المستخدم يكتب الحين (حقل نص مفعّل) أو لسه خارج منه قبل لحظات؟ */
  private isTyping(): boolean {
    if (performance.now() < this.typingUntil) return true;
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }
  private onFocusOut = () => { this.typingUntil = performance.now() + 1000; };

  private onResize = () => {
    const w = window.innerWidth;
    // كيبورد الجوال يفتح/يسكّر: يتغير الارتفاع بس والعرض ثابت، فما نعيد الحساب (يخرّب أطوال التثبيت)
    if (this.isTyping() && w === this.lastW) return;
    this.lastW = w;
    this.measure();
    this.paint();
  };

  private onScroll = () => {
    const y = window.scrollY;
    if (y > this.lastY) this.dir = 1; else if (y < this.lastY) this.dir = -1;
    this.lastY = y;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
    clearTimeout(this.idleT);
    this.idleT = setTimeout(this.onIdle, 140);
  };

  private onWheel = (e: WheelEvent) => { if (e.deltaY < 0) this.cancel(); };   // سكرول لتحت أثناء الحركة ما يوقفها
  private onUser = () => this.cancel();
  private onTouchStart = () => { this.touching = true; this.cancel(); };
  private onTouchEnd = () => { this.touching = false; clearTimeout(this.idleT); this.idleT = setTimeout(this.onIdle, 140); };

  /** نداء من روابط النافبار: ما نشغّل حركات تلقائية أثناء التنقّل */
  private onNav = () => {
    this.cancel();
    this.suppress = true;
    clearTimeout(this.idleT);
    this.idleT = setTimeout(this.onIdle, 140);
  };

  /** وقف السكرول: لو سكشن جديد عالق بنص الانتقال (وأنت نازل) نكمله لين يستقر */
  private onIdle = () => {
    this.suppress = false;
    if (this.anim || this.touching || this.dir <= 0 || this.isTyping()) return;
    for (const o of this.overs) {
      if (!o.done && this.zone(o, o.el.getBoundingClientRect().top)) { this.start(o); break; }
    }
  };

  private cancel(): void {
    if (this.anim) { cancelAnimationFrame(this.anim.raf); this.anim = null; }
  }

  /** ظهر من السكشن الجديد ما يكفي (TRIGGER) وما وصل أعلى الشاشة؟ */
  private zone(o: Over, top: number): boolean {
    const vh = window.innerHeight;
    return top > 2 && vh - top >= Math.min(TRIGGER * o.el.offsetHeight, vh * MAX_SHOW);
  }

  /** top لكل سكشن مثبّت + نصف قطر الزاوية الأقصى لكل سكشن جديد */
  private measure(): void {
    const vh = window.innerHeight;
    for (const p of this.pins) if (!p.classList.contains('stk-free')) p.style.top = Math.min(0, vh - p.offsetHeight) + 'px';
    for (const o of this.overs) if (!o.done) o.r = Math.max(0, -parseFloat(getComputedStyle(o.el).marginTop) || 0);
  }

  /** الزاوية كبيرة وهو داخل من تحت وتصغر لين تختفي. وإذا عدّيته نسجّله مستقر. وإذا ظهر منه الكفاية نكمله */
  private paint(): void {
    const vh = window.innerHeight;
    for (const o of this.overs) {
      if (o.done) continue;
      const top = o.el.getBoundingClientRect().top;
      o.el.style.setProperty('--cr', (o.r * clamp(top / (vh * 0.7), 0, 1)).toFixed(1) + 'px');
      if (top <= 0.5) { this.settle(o); continue; }
      if (this.dir > 0 && this.zone(o, top)) this.start(o);
    }
  }

  /** حركة تلقائية وحدة تكمل لين يغطي السكشن الجديد السابق ويستقر (easeOutCubic) */
  private start(o: Over): void {
    if (o.done || this.anim || this.suppress || this.touching || this.dir <= 0 || this.isTyping()) return;
    const anchor = o.el.previousElementSibling as HTMLElement | null;           // علامة مكان السكشن الأصلي
    const natural = anchor ? anchor.getBoundingClientRect().top + window.scrollY - o.r : o.el.getBoundingClientRect().top + window.scrollY;
    const from = window.scrollY;
    const dist = natural - from;
    if (dist <= 1) { this.settle(o); return; }
    const dur = clamp(dist * 1.1, 480, 950);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = clamp((now - t0) / dur, 0, 1);
      const y = k >= 1 ? natural : from + dist * (1 - Math.pow(1 - k, 3));
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });      // instant عشان html فيه scroll-behavior: smooth
      if (k < 1) this.anim = { raf: requestAnimationFrame(step) };
      else { this.anim = null; this.settle(o); }
    };
    this.anim = { raf: requestAnimationFrame(step) };
  }

  /** السكشن استقر نهائياً: زواياه صفر، والسكشن السابق ينفك تثبيته (ما يظهر منه شي لأن الجديد يغطيه)، فما ترجع أي حركة */
  private settle(o: Over): void {
    if (o.done) return;
    o.done = true;
    o.el.style.setProperty('--cr', '0px');
    this.io?.unobserve(o.el);
    const prev = o.el.previousElementSibling?.previousElementSibling as HTMLElement | null;   // قبل العلامة
    if (prev?.classList.contains('stk-pin')) { prev.style.removeProperty('top'); prev.classList.add('stk-free'); }
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('stk-nav', this.onNav);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('mousedown', this.onUser);
    window.removeEventListener('keydown', this.onUser);
    window.removeEventListener('focusout', this.onFocusOut);
    this.cancel();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.idleT);
    this.ro?.disconnect();
    this.io?.disconnect();
  }
}