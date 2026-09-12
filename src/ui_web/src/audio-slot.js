import { getAndroidBridge } from "./native-bridge.js";

const android = getAndroidBridge();

// audio.js drives two interchangeable "slots" so it can crossfade between
// them. This factory hands it either a real <audio> element (unchanged
// from before) or, under Android, a thin proxy over the native
// MediaPlayer-backed bridge that mimics exactly the handful of
// HTMLAudioElement members audio.js actually touches -- play(), pause(),
// src, currentTime, duration, volume, paused, removeAttribute('src'),
// load(), and addEventListener('play'|'pause'|'timeupdate'|'ended'|'error').
// audio.js itself needs no native-vs-web branching at all as a result.
export function createAudioSlot() {
    if (!android) {
        const a = new Audio();
        a.preload = "auto";
        return a;
    }
    return new NativeAudioSlot(nextSlotIndex++);
}

let nextSlotIndex = 0;
const registry = {};

// Single entry point Android calls back into (via WebView.evaluateJavascript)
// for every slot's playback events.
window.__nativeAudioEvent = (index, type, detail) => {
    registry[index] && registry[index]._onEvent(type, detail || {});
};

class NativeAudioSlot {
    constructor(index) {
        this.index = index;
        this._src = "";
        this._paused = true;
        this._duration = NaN;
        this._currentTime = 0;
        this._volume = 1;
        this.error = null;
        this._listeners = {};
        registry[index] = this;
    }

    addEventListener(type, cb) {
        (this._listeners[type] || (this._listeners[type] = [])).push(cb);
    }

    _emit(type) {
        for (const cb of this._listeners[type] || []) cb();
    }

    _onEvent(type, detail) {
        switch (type) {
        case "play":  this._paused = false; break;
        case "pause": this._paused = true;  break;
        case "timeupdate":
            if (typeof detail.currentTime === "number") this._currentTime = detail.currentTime;
            if (typeof detail.duration === "number")    this._duration    = detail.duration;
            break;
        case "ended": this._paused = true; this._currentTime = 0; break;
        case "error": this.error = detail; break;
        }
        this._emit(type);
    }

    get src() { return this._src; }
    set src(url) {
        this._src = url || "";
        this._currentTime = 0;
        this._duration = NaN;
        android.audioSetSrc(this.index, this._src);
    }

    get paused()      { return this._paused; }
    get duration()    { return this._duration; }
    get currentTime() { return this._currentTime; }
    set currentTime(t) {
        this._currentTime = t;
        android.audioSeek(this.index, t);
    }
    get volume() { return this._volume; }
    set volume(v) {
        this._volume = v;
        android.audioSetVolume(this.index, v);
    }

    play() {
        android.audioPlay(this.index);
        return Promise.resolve();
    }

    pause() {
        android.audioPause(this.index);
    }

    // audio.js only ever calls this with "src", to hard-stop a slot
    // (stopAudio()); mirror <audio>'s own removeAttribute("src") + load()
    // reset-to-empty behaviour.
    removeAttribute(name) {
        if (name !== "src") return;
        this._src = "";
        android.audioSetSrc(this.index, "");
    }

    load() { /* no separate "load" step needed on the native side */ }
}
