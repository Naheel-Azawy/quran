class ViewPager {
    constructor(opts) {
        const {
            parent,
            pageRenderer,
            onChange        = () => {},
            totalPages      = Infinity,
            initPage        = 0,
            transitionSpeed = 200,
        } = opts;

        if (!parent)       throw Error("parent must be set");
        if (!pageRenderer) throw Error("pageRenderer must be set");

        // Consts
        this.parent          = parent;
        this.renderPageUser  = pageRenderer;
        this.onChange        = onChange;
        this.totalPages      = totalPages;
        this.currentPage     = initPage;
        this.transitionSpeed = transitionSpeed;
        this.threshold       = 50; // swipe sensitivity
        this.rtl = document.defaultView
            .getComputedStyle(parent, null)
            .getPropertyValue("direction") == "rtl";

        // Vars
        this.renderedPages = {};
        this.startX        = 0;
        this.startI        = null;
        this.isDragging    = false;
        this.locked        = false;
        this.deltaX        = 0;
        this.basic         = false;
        this.lastChange    = Date.now();

        this.container = document.createElement("div");
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
        this.onChange(this.currentPage);
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
            if (deltaX < -this.threshold && this.currentPage < this.totalPages - 1) {
                diff = +1;
            } else if (deltaX > this.threshold && this.currentPage > 0) {
                diff = -1;
            }
        } else {
            if (deltaX < -this.threshold && this.currentPage > 0) {
                diff = -1;
            } else if (deltaX > this.threshold &&
                       this.currentPage < this.totalPages - 1) {
                diff = +1;
            }
        }
        this.currentPage += diff;
        endI += diff;

        // Re-enable transition before snapping into place
        requestAnimationFrame(() => {
            this.container.style.transition = `transform ${this.transitionSpeed}ms ease`;
            this._updatePager(endI);
            if (pageBak != this.currentPage) {
                this.onChange(this.currentPage);
            }
        });
    }

    _updatePager(i=null, animate=true) {
        // Position and move container
        if (this.basic) {
            this._renderPage(this.currentPage);
        } else {
            this.locked = true;
            this._renderPage(this.currentPage);
            if (this.currentPage >                   0) this._renderPage(this.currentPage - 1);
            if (this.currentPage < this.totalPages - 1) this._renderPage(this.currentPage + 1);
            // NOTE: possible improvement: when moving in one direction quickly, load more
            //       pages in advance in that direction
        }
        for (let child of this.container.children) {
            child.style.minHeight = "100%";
            child.style.minWidth  = this.parent.getBoundingClientRect().width + "px";
        }
        if (this.basic) return;
        if (i == null) i = this._translateIndex();
        this._translateToIndex(i, animate);
        const that = this;
        setTimeout(() => that._cleanupPages(), this.transitionSpeed + 10);
    }

    _renderPage(index) {
        if (this.basic) {
            const page = this.renderPageUser(index);
            this.container.innerHTML = "";
            this.container.appendChild(page);
        } else {
            if (this.renderedPages[index]) return;
            const page = this.renderPageUser(index);
            this.container.appendChild(page);
            this.renderedPages[index] = page;
        }
    }

    _cleanupPages() {
        if (this.basic) return;
        const keep = [];
        if (this.currentPage > 0) keep.push(this.currentPage - 1);
        keep.push(this.currentPage);
        if (this.currentPage < this.totalPages - 1) keep.push(this.currentPage + 1);
        this.container.innerHTML = "";
        for (let p in this.renderedPages) {
            p = Number(p);
            if (!keep.includes(p)) {
                delete this.renderedPages[p];
            } else {
                this.container.appendChild(this.renderedPages[p]);
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
        const pages = Object.keys(this.renderedPages);
        let i;
        for (i = 0; i < pages.length; ++i) {
            if (pages[i] == this.currentPage) {
                break;
            }
        }
        return i;
    }

    next() {
        this.goto(this.currentPage + 1);
    }

    prev() {
        this.goto(this.currentPage - 1);
    }

    goto(page) {
        page = Number(page);
        if (this.locked ||
            page == this.currentPage ||
            page < 0 || page >= this.totalPages) {
            return;
        }
        const i = page > this.currentPage ?
              Object.keys(this.renderedPages).length - 1 : 0;
        this.currentPage = page;
        this._updatePager(i);
        this.onChange(this.currentPage);
        this.lastChange = Date.now();
    }

    reload() {
        for (let p in this.renderedPages) {
            delete this.renderedPages[p];
        }
        this._updatePager();
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
