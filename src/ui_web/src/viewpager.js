export default class ViewPager {
    constructor(opts) {
        const {
            parent,
            pageRenderer,
            onChange        = () => {},
            totalPages      = Infinity,
            initPage        = 0,
            transitionSpeed = 200,
            pagesPerView    = 1,
        } = opts;

        if (!parent)       throw Error("parent must be set");
        if (!pageRenderer) throw Error("pageRenderer must be set");

        // Consts
        this.parent          = parent;
        this.renderPageUser  = pageRenderer;
        this.onChange        = onChange;
        this.totalPages      = totalPages;
        this.transitionSpeed = transitionSpeed;
        this.threshold       = 50; // swipe sensitivity
        this.rtl = document.defaultView
            .getComputedStyle(parent, null)
            .getPropertyValue("direction") == "rtl";

        // Paging is always done in units of "groups" -- a group is one
        // slide of the pager and holds `pagesPerView` real pages side by
        // side (book/spread mode) or just 1 (the normal, single-page
        // mode). Everything below (dragging, preloading neighbours,
        // cleanup) operates on group indices; only the public API
        // (goto/onChange) still talks in absolute page numbers, so
        // callers never need to know which mode is active.
        this.pagesPerView = Math.max(1, pagesPerView);
        this.totalGroups  = this._groupCount();
        this.currentGroup = this._groupOf(initPage);
        this.currentPage  = this.currentGroup * this.pagesPerView;

        // Vars
        this.renderedPages = {}; // keyed by group index, not page number
        this.startX        = 0;
        this.startI        = null;
        this.isDragging    = false;
        this.locked        = false;
        this.deltaX        = 0;
        this.basic         = false;
        this.lastChange    = Date.now();

        this.container = document.createElement("div");
        this.container.className = "vp-container";
        this.parent.appendChild(this.container);
        this.container.style.width = this.container.style.height = "100%";
        this.container.style.display = "flex";
        this.parent.style.overflowX = "hidden";

        this.container.addEventListener("touchstart", (e) => {
            if (this.basic) return;
            this._touchStart(e);
        });

        this.container.addEventListener("touchmove", (e) => {
            if (this.basic) return;
            this._touchMove(e);
        });

        this.container.addEventListener("touchend", () => {
            if (this.basic) return;
            this._touchEnd();
        });

        this._updatePager();
        this.onChange(this.currentPage, this._navState());
    }

    // ---------- page/group index helpers ----------

    _groupOf(page) {
        return Math.floor(page / this.pagesPerView);
    }

    _groupCount() {
        return this.totalPages === Infinity
            ? Infinity
            : Math.ceil(this.totalPages / this.pagesPerView);
    }

    // Real (absolute) page numbers making up group g, in ascending
    // (reading) order; the last group may be short a page if totalPages
    // isn't a multiple of pagesPerView.
    _groupPages(g) {
        const start = g * this.pagesPerView;
        const pages = [];
        for (let k = 0; k < this.pagesPerView; ++k) {
            const p = start + k;
            if (this.totalPages !== Infinity && p >= this.totalPages) break;
            pages.push(p);
        }
        return pages;
    }

    _navState() {
        return {
            hasPrev: this.currentGroup > 0,
            hasNext: this.currentGroup < this.totalGroups - 1,
        };
    }

    // Whether `page` is part of the group/spread currently on screen --
    // in book mode that's true for both the right and left page, not just
    // the group's anchor (first) page.
    isVisible(page) {
        return this._groupOf(page) === this.currentGroup;
    }

    _touchStart(e) {
        if (this.locked ||
            e.touches.length > 1 ||
            e.target.id == "num") return;
        this.startX = e.touches[0].clientX;
        this.startI = this._translateIndex();
        this.deltaX = 0;
        this.isDragging = true;
        this.container.style.transition = "none";
    }

    _touchMove(e) {
        if (!this.isDragging) return;
        if (e.touches.length > 1) {
            this._touchEnd();
            return;
        }
        this.deltaX = e.touches[0].clientX - this.startX;
        if (!this.rtl) this.deltaX *= -1;
        this._translateToDelta(this.startI, this.deltaX);
    }

    _touchEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;
        let endI = this.startI;
        let diff = 0;
        const pageBak = this.currentPage;
        let deltaX = this.deltaX;
        if (this.rtl) deltaX *= -1;

        if (this.rtl) {
            if (deltaX < -this.threshold && this.currentGroup < this.totalGroups - 1) {
                diff = +1;
            } else if (deltaX > this.threshold && this.currentGroup > 0) {
                diff = -1;
            }
        } else {
            if (deltaX < -this.threshold && this.currentGroup > 0) {
                diff = -1;
            } else if (deltaX > this.threshold &&
                       this.currentGroup < this.totalGroups - 1) {
                diff = +1;
            }
        }
        this.currentGroup += diff;
        this.currentPage  = this.currentGroup * this.pagesPerView;
        endI += diff;

        // Re-enable transition before snapping into place
        requestAnimationFrame(() => {
            this.container.style.transition = `transform ${this.transitionSpeed}ms ease`;
            this._updatePager(endI);
            if (pageBak != this.currentPage) {
                this.onChange(this.currentPage, this._navState());
            }
        });
    }

    _updatePager(i=null, animate=true) {
        // Position and move container
        if (this.basic) {
            this._renderGroup(this.currentGroup);
        } else {
            this.locked = true;
            this._renderGroup(this.currentGroup);
            if (this.currentGroup >                    0) this._renderGroup(this.currentGroup - 1);
            if (this.currentGroup < this.totalGroups - 1) this._renderGroup(this.currentGroup + 1);
            // NOTE: possible improvement: when moving in one direction quickly, load more
            //       groups in advance in that direction
        }
        // Slide sizing (each one exactly filling the container) is pure
        // CSS (see .vp-container > * in style.css) rather than a pixel
        // value measured here and baked in -- that used to go stale
        // whenever the container's box changed after the fact (a resize,
        // a CSS transition still mid-flight, a mobile browser's chrome
        // collapsing after load...), leaving old slides sized for a box
        // that no longer existed until the next navigation re-measured
        // them. CSS tracks the live box on every frame, so there's
        // nothing to go stale.
        if (this.basic) return;
        if (i == null) i = this._translateIndex();
        this._translateToIndex(i, animate);
        const that = this;
        setTimeout(() => that._cleanupPages(), this.transitionSpeed + 10);
    }

    // Builds one slide: a lone page in normal mode, or a flex row holding
    // `pagesPerView` pages (in ascending/reading order) in book mode. The
    // slide inherits the pager's own RTL direction, so the first (lowest-
    // numbered, earliest-read) page naturally lands on the right and
    // later pages continue to its left -- exactly how an open Mushaf
    // reads, with no extra bookkeeping needed here.
    _buildSlide(group) {
        const pages = this._groupPages(group);
        if (this.pagesPerView === 1) {
            return this.renderPageUser(pages[0]);
        }
        const slide = document.createElement("div");
        slide.className = "vp-slide";
        for (const p of pages) {
            slide.appendChild(this.renderPageUser(p));
        }
        return slide;
    }

    _renderGroup(group) {
        if (this.basic) {
            const slide = this._buildSlide(group);
            this.container.innerHTML = "";
            this.container.appendChild(slide);
        } else {
            if (this.renderedPages[group]) return;
            const slide = this._buildSlide(group);
            this.container.appendChild(slide);
            this.renderedPages[group] = slide;
        }
    }

    _cleanupPages() {
        if (this.basic) return;
        const keep = [];
        if (this.currentGroup > 0) keep.push(this.currentGroup - 1);
        keep.push(this.currentGroup);
        if (this.currentGroup < this.totalGroups - 1) keep.push(this.currentGroup + 1);
        this.container.innerHTML = "";
        for (let g in this.renderedPages) {
            g = Number(g);
            if (!keep.includes(g)) {
                delete this.renderedPages[g];
            } else {
                this.container.appendChild(this.renderedPages[g]);
            }
        }
        this._translateToIndex(this._translateIndex(), false);
        this.locked = false;
    }

    _translateToPx(offset) {
        this.container.style.transform = `translateX(${offset}px)`;
    }

    _translateToIndex(i, animate) {
        if (this.basic) return;
        if (animate) {
            this.container.style.transition = `transform ${this.transitionSpeed}ms ease`;
        } else {
            this.container.style.transition = "none";
        }
        let offset = i * this.container.getBoundingClientRect().width;
        if (!this.rtl) offset *= -1;
        this._translateToPx(offset);
    }

    _translateToDelta(i, deltaX) {
        if (this.basic) return;
        const m = this.container.getBoundingClientRect().width;
        if      (deltaX >  m) deltaX =  m;
        else if (deltaX < -m) deltaX = -m;
        let offset = i * this.container.getBoundingClientRect().width + deltaX;
        if (!this.rtl) offset *= -1;
        this._translateToPx(offset);
    }

    _translateIndex() {
        if (this.basic) return 0;
        const groups = Object.keys(this.renderedPages);
        let i;
        for (i = 0; i < groups.length; ++i) {
            if (groups[i] == this.currentGroup) {
                break;
            }
        }
        return i;
    }

    next() {
        this._gotoGroup(this.currentGroup + 1);
    }

    prev() {
        this._gotoGroup(this.currentGroup - 1);
    }

    // Public API stays page-based: callers pass/receive absolute page
    // numbers and never need to know the current pagesPerView.
    goto(page) {
        page = Number(page);
        if (page < 0 || page >= this.totalPages) return;
        this._gotoGroup(this._groupOf(page));
    }

    _gotoGroup(group) {
        if (this.locked ||
            group == this.currentGroup ||
            group < 0 || group >= this.totalGroups) {
            return;
        }
        const i = group > this.currentGroup ?
              Object.keys(this.renderedPages).length - 1 : 0;
        this.currentGroup = group;
        this.currentPage  = group * this.pagesPerView;
        this._updatePager(i);
        this.onChange(this.currentPage, this._navState());
        this.lastChange = Date.now();
    }

    reload() {
        for (let p in this.renderedPages) {
            delete this.renderedPages[p];
        }
        this._updatePager();
    }

    // Switches between normal (1 page) and book/spread (N pages) mode in
    // place, re-anchoring on whatever page was on the right/first side of
    // the current view. Only updates bookkeeping and clears the stale
    // DOM -- callers are expected to follow up with reload() (or resize
    // already does its own reload() right after, so a resize-triggered
    // mode switch doesn't render twice).
    setPagesPerView(n) {
        n = Math.max(1, n);
        if (n === this.pagesPerView) return;
        const anchorPage = this.currentPage;
        this.pagesPerView = n;
        this.totalGroups  = this._groupCount();
        this.currentGroup = this._groupOf(anchorPage);
        this.currentPage  = this.currentGroup * this.pagesPerView;
        for (const g in this.renderedPages) delete this.renderedPages[g];
        this.container.innerHTML = "";
        this.onChange(this.currentPage, this._navState());
    }

    static example() {
        return new ViewPager({
            parent:       document.getElementById("con"),
            initPage:     0,
            totalPages:   Infinity,
            onChange:     index => document.getElementById("num").value = index,
            pageRenderer: index => {
                const page = document.createElement("div");
                page.className = "page";
                page.innerText = `Page #${index} ${Date()}`;
                return page;
            }
        });
    }
}
