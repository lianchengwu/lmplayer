/**
 * HTML5 音频播放器 - 统一版本
 * 包含播放器核心类和页面集成功能
 */

function normalizeSongUrls(data) {
  if (!data) {
    return [];
  }

  const normalizedUrls = [];
  const seenUrls = new Set();
  const appendUrl = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed || seenUrls.has(trimmed)) {
      return;
    }

    seenUrls.add(trimmed);
    normalizedUrls.push(trimmed);
  };

  if (Array.isArray(data.urls)) {
    data.urls.forEach(appendUrl);
  }

  return normalizedUrls;
}

/**
 * HTML5 音频播放器类
 * 使用原生 HTML5 Audio API 实现音频播放功能
 */
class HTML5AudioPlayer {
  constructor() {
    this.audio = null;
    this.currentSong = null;
    this._isPlaying = false;
    this.volume = 0.5;
    this.playUrls = [];
    this.currentUrlIndex = 0;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.playbackMetrics = null;
    this.lastPlaybackBlockReason = null;

    // 播放进度与过早结束恢复控制
    this.prematureEndCount = 0;
    this.maxPrematureRetries = 3;
    this.lastPlaybackPosition = 0;
    this.isBuffering = false;
    this.isManuallyStopped = false;
    this.isRecovering = false;

    // 调试变量
    this.lastLoggedCurrentTime = 0;
    this.durationLogged = false;

    // 事件回调
    this.onPlayCallback = null;
    this.onPauseCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;
    this.onLoadCallback = null;
    this.onTimeUpdateCallback = null;

    // 🔧 内存泄漏修复：创建专用资源管理器
    if (typeof ResourceManager !== "undefined") {
      this.resourceManager = new ResourceManager("HTML5AudioPlayer");
    } else {
      console.warn("⚠️ ResourceManager 未加载，使用降级模式");
      this.resourceManager = null;
    }

    // 初始化音频元素
    this.initializeAudioElement();
  }

  resetPlaybackMetrics(song, url) {
    this.lastPlaybackBlockReason = null;
    this.playbackMetrics = {
      songHash: song?.hash || "",
      songName: song?.songname || song?.title || "未知歌曲",
      url,
      startedAt: performance.now(),
      marks: {
        srcAssigned: null,
        loadedmetadata: null,
        loadeddata: null,
        canplay: null,
        playResolved: null,
      },
    };
  }

  markPlaybackMetric(stage) {
    if (!this.playbackMetrics || !this.playbackMetrics.marks) {
      return;
    }

    if (this.playbackMetrics.marks[stage] !== null) {
      return;
    }

    const now = performance.now();
    this.playbackMetrics.marks[stage] = now;
    const elapsed = (now - this.playbackMetrics.startedAt).toFixed(1);
    console.log(
      `⏱️ 播放阶段 [${stage}] ${elapsed}ms`,
      {
        song: this.playbackMetrics.songName,
        hash: this.playbackMetrics.songHash,
        url: this.playbackMetrics.url,
      },
    );
  }

  logPlaybackMetricsSummary(status = "completed") {
    if (!this.playbackMetrics) {
      return;
    }

    const marks = this.playbackMetrics.marks;
    const relative = Object.fromEntries(
      Object.entries(marks).map(([key, value]) => [
        key,
        value === null ? null : Number((value - this.playbackMetrics.startedAt).toFixed(1)),
      ]),
    );

    console.log("⏱️ 播放耗时汇总", {
      status,
      song: this.playbackMetrics.songName,
      hash: this.playbackMetrics.songHash,
      url: this.playbackMetrics.url,
      stagesMs: relative,
    });
  }

  /**
   * 初始化音频元素
   */
  initializeAudioElement() {
    // 🔧 内存泄漏修复：先清理旧的音频实例
    if (this.audio) {
      this.destroyAudioElement();
    }

    // 🔧 内存泄漏修复：使用资源管理器创建Audio实例
    if (this.resourceManager) {
      this.audio = this.resourceManager.createAudio();
    } else {
      this.audio = new Audio();
    }
    this.audio.preload = "metadata";
    this.audio.volume = this.volume;

    // 绑定事件监听器
    this.setupEventListeners();

    console.log("🎵 HTML5 Audio 播放器初始化完成");
  }

  /**
   * 销毁音频元素
   */
  destroyAudioElement() {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();

        // 如果使用资源管理器，通过它来销毁
        if (this.resourceManager) {
          this.resourceManager.destroyAudio(this.audio);
        }
      } catch (error) {
        console.warn("销毁音频元素时出错:", error);
      }
      this.audio = null;
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (!this.audio) return;

    // 🔧 内存泄漏修复：使用资源管理器管理事件监听器
    const addListener = (event, handler) => {
      if (this.resourceManager) {
        this.resourceManager.addEventListener(this.audio, event, handler);
      } else {
        this.audio.addEventListener(event, handler);
      }
    };

    // 播放开始
    addListener("play", () => {
      this._isPlaying = true;
      console.log("🎵 播放开始");
      if (this.onPlayCallback) this.onPlayCallback();
    });

    // 暂停
    let stallTimeoutTimer = null;
    const clearStallTimer = () => {
      if (stallTimeoutTimer) {
        clearTimeout(stallTimeoutTimer);
        stallTimeoutTimer = null;
      }
    };

    addListener("pause", () => {
      clearStallTimer();
      this._isPlaying = false;
      console.log("⏸️ 播放暂停");
      if (this.onPauseCallback) this.onPauseCallback();
    });

    // 缓冲中（卡顿）
    addListener("waiting", () => {
      this.isBuffering = true;
      console.log("⏳ 音频正在缓冲中 (waiting)... 当前位置:", this.audio ? this.audio.currentTime.toFixed(1) : 0);
      clearStallTimer();
      if (this._isPlaying && !this.isManuallyStopped) {
        stallTimeoutTimer = setTimeout(() => {
          if (this.isBuffering && this._isPlaying && !this.isManuallyStopped) {
            console.warn("⚠️ 音频卡住超时(>12s)，尝试自动恢复播放...");
            const currentPos = this.audio ? this.audio.currentTime : 0;
            this.recoverPrematurePlayback(currentPos);
          }
        }, 12000);
      }
    });

    // 缓冲恢复，继续播放
    addListener("playing", () => {
      clearStallTimer();
      this.isBuffering = false;
      this._isPlaying = true;
      console.log("▶️ 音频恢复播放 (playing)");
    });

    // 下载停滞：浏览器在缓冲填满或网络空闲时会正常触发stalled，只要音频仍在播放，绝不能打断！
    addListener("stalled", () => {
      console.log("ℹ️ 音频下载处于空闲/停滞状态 (stalled)");
      // 仅当确实处于卡顿缓冲等待中(isBuffering为true)且未设置定时器时，才等待超时恢复
      if (this.isBuffering && !stallTimeoutTimer && this._isPlaying && !this.isManuallyStopped) {
        stallTimeoutTimer = setTimeout(() => {
          if (this.isBuffering && this._isPlaying && !this.isManuallyStopped) {
            console.warn("⚠️ 音频缓冲停滞超时(>12s)，尝试自动恢复播放...");
            const currentPos = this.audio ? this.audio.currentTime : 0;
            this.recoverPrematurePlayback(currentPos);
          }
        }, 12000);
      }
    });

    // 播放结束
    addListener("ended", async () => {
      // 如果处于手动停止中，忽略
      if (this.isManuallyStopped) {
        console.log("⏹️ 播放已手动停止，忽略 ended 事件");
        return;
      }

      // 如果正在自动恢复中，忽略
      if (this.isRecovering) {
        console.log("🔄 正在恢复播放中，忽略 ended 事件");
        return;
      }

      const currentTime = (this.audio && this.audio.currentTime > 0)
        ? this.audio.currentTime
        : (this.lastPlaybackPosition || 0);
      const audioDuration = (this.audio && Number.isFinite(this.audio.duration) && this.audio.duration > 0)
        ? this.audio.duration
        : 0;
      const songDuration = Number(this.currentSong?.time_length || this.currentSong?.duration || 0) || 0;

      // 计算预期总时长：若元数据有时长（如240s）且 audio.duration 异常偏小（网络断开导致WebKit折叠duration），以元数据为准
      let expectedDuration = audioDuration;
      if (songDuration > 10) {
        if (expectedDuration <= 0 || expectedDuration < songDuration - 10) {
          expectedDuration = songDuration;
        }
      }

      // 判断是否是异常过早结束（起播卡顿、流中断、网络断开等导致提前触发 EOS）
      // 1. 如果总长大于 10 秒，当前进度离结尾大于 5 秒，且播放比例不足 95%
      // 2. 或总长未知但已播放进度小于 10 秒
      const isPremature = (expectedDuration > 10 && currentTime < (expectedDuration - 5) && (currentTime / expectedDuration < 0.95)) ||
                          (expectedDuration <= 0 && currentTime < 10);

      if (isPremature) {
        console.warn(`⚠️ 捕获到音频过早结束异常: 当前进度 ${currentTime.toFixed(1)}s / 总时长 ${expectedDuration.toFixed(1)}s，非正常播完！尝试恢复播放...`);

        const recovered = await this.recoverPrematurePlayback(currentTime);
        if (recovered) {
          return;
        }

        // 尝试恢复失败，进入错误重试流程，绝不能作为自然结束切歌！
        console.error("❌ 音频过早结束且无法自动恢复，转入错误重试");
        await this.handlePlaybackError();
        return;
      }

      this._isPlaying = false;
      this.prematureEndCount = 0;
      this.lastPlaybackPosition = 0;
      console.log("🎵 播放正常结束");
      if (this.onEndCallback) this.onEndCallback();
    });

    // 错误处理
    addListener("error", (e) => {
      if (this.isManuallyStopped) {
        console.log("⏹️ 播放已被手动停止，忽略后续错误事件");
        return;
      }
      const error = this.audio.error;
      let errorMessage = "未知错误";

      if (error) {
        if (error.code === error.MEDIA_ERR_ABORTED) {
          console.log("🎵 播放加载被中止 (MEDIA_ERR_ABORTED)，忽略");
          return;
        }
        switch (error.code) {
          case error.MEDIA_ERR_NETWORK:
            errorMessage = "网络错误";
            break;
          case error.MEDIA_ERR_DECODE:
            errorMessage = "解码错误";
            break;
          case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = "音频格式不支持或URL无效";
            break;
          default:
            errorMessage = `错误代码: ${error.code}`;
        }
      }

      console.error("🎵 播放错误:", errorMessage, "当前URL:", this.audio.src);
      console.error("🎵 错误事件:", e);
      console.error("🎵 音频错误对象:", error);

      this.handlePlaybackError();
    });

    // 加载完成
    addListener("loadedmetadata", () => {
      this.markPlaybackMetric("loadedmetadata");
    });

    addListener("loadeddata", () => {
      this.markPlaybackMetric("loadeddata");
      console.log("🎵 音频数据加载完成");
      if (this.onLoadCallback) this.onLoadCallback();
    });

    // 时间更新：只要进度在走，说明正在健康播放，立刻清除卡顿定时器与缓冲标记！
    addListener("timeupdate", () => {
      if (this.audio && this.audio.currentTime > 0) {
        if (Math.abs(this.audio.currentTime - (this.lastPlaybackPosition || 0)) > 0.05) {
          clearStallTimer();
          this.isBuffering = false;
        }
        this.lastPlaybackPosition = this.audio.currentTime;
      }
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(this.audio.currentTime, this.audio.duration);
      }
    });

    // 可以播放
    addListener("canplay", () => {
      this.markPlaybackMetric("canplay");
      console.log("🎵 音频可以开始播放");
    });

    // 缓冲进度 - 🔧 内存泄漏修复：使用资源管理器管理事件监听器
    addListener("progress", () => {
      if (this.audio.buffered.length > 0) {
        const bufferedEnd = this.audio.buffered.end(
          this.audio.buffered.length - 1,
        );
        const duration = this.audio.duration;
        if (duration > 0) {
          const bufferedPercent = (bufferedEnd / duration) * 100;
          // console.log(`🎵 缓冲进度: ${bufferedPercent.toFixed(1)}%`);
        }
      }
    });
  }

  /**
   * 播放歌曲
   */
  async play(song, urls) {
    console.log("🎵 开始播放歌曲:", song?.songname || "未知歌曲");

    if (!song) {
      console.error("🎵 歌曲参数无效");
      return false;
    }

    // 确保urls是数组
    let urlArray = [];
    if (typeof urls === "string") {
      // 如果是字符串，转换为数组
      urlArray = [urls];
      console.log("🎵 将字符串URL转换为数组:", urlArray);
    } else if (Array.isArray(urls)) {
      urlArray = urls;
    } else {
      console.error("🎵 播放地址参数无效:", urls);
      return false;
    }

    if (urlArray.length === 0) {
      console.error("🎵 没有有效的播放地址");
      return false;
    }

    // 先设置歌曲信息
    this.currentSong = song;
    this.playUrls = urlArray;
    this.currentUrlIndex = 0;
    this.retryCount = 0;
    this.prematureEndCount = 0;
    this.lastPlaybackPosition = 0;
    this.isManuallyStopped = false;
    this.isRecovering = false;

    console.log("🎵 开始播放歌曲:", song);

    // 立即更新歌曲信息显示（在设置currentSong之后立即执行）
    console.log("🎵 HTML5播放器更新歌曲信息");

    // 确保立即更新，不等待任何异步操作
    try {
      if (typeof window.updateSongInfo === "function") {
        window.updateSongInfo(song);
        console.log("🎵 歌曲信息更新完成，开始播放音频");
      }
    } catch (error) {
      console.error("❌ 更新歌曲信息失败:", error);
    }

    return await this.tryPlayUrl();
  }

  /**
   * 销毁播放器实例
   */
  destroy() {
    console.log("🧹 销毁HTML5播放器实例");

    // 停止播放
    this.stop();

    // 销毁音频元素
    this.destroyAudioElement();

    // 清理回调函数
    this.onPlayCallback = null;
    this.onPauseCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;
    this.onLoadCallback = null;
    this.onTimeUpdateCallback = null;

    // 清理资源管理器
    if (this.resourceManager) {
      this.resourceManager.cleanup();
      this.resourceManager = null;
    }

    // 清理其他属性
    this.currentSong = null;
    this.playUrls = [];
    this.currentUrlIndex = 0;
    this.retryCount = 0;
    this.prematureEndCount = 0;
    this.lastPlaybackPosition = 0;
    this.isRecovering = false;

    console.log("✅ HTML5播放器实例已销毁");
  }

  /**
   * 恢复异常过早结束的音频播放
   */
  async recoverPrematurePlayback(savedTime) {
    if (this.isRecovering) return false;
    this.isRecovering = true;
    this.prematureEndCount = (this.prematureEndCount || 0) + 1;

    console.log(`🔄 正在尝试恢复播放 (第 ${this.prematureEndCount}/${this.maxPrematureRetries} 次)，保存进度: ${savedTime.toFixed(1)}s`);

    if (this.prematureEndCount > this.maxPrematureRetries) {
      console.warn("⚠️ 已达到过早结束最大重试次数");
      // 如果还有备用播放地址，尝试切换到下一个播放地址
      if (this.currentUrlIndex + 1 < this.playUrls.length) {
        this.currentUrlIndex++;
        this.prematureEndCount = 0;
        console.log(`🔄 切换到备用播放地址恢复 (${this.currentUrlIndex + 1}/${this.playUrls.length})`);
        const success = await this.tryPlayUrl(savedTime);
        this.isRecovering = false;
        return success;
      }
      this.isRecovering = false;
      return false;
    }

    try {
      // 1. 优先检查本地缓存是否已经下载完毕
      if (this.currentSong?.hash) {
        try {
          const { GetCachedURL } = await import("./bindings/wmplayer/cacheservice.js");
          const cached = await GetCachedURL(this.currentSong.hash);
          if (cached?.success && cached?.data) {
            console.log("✅ 发现已完成的本地音频缓存，切换到本地缓存恢复播放:", cached.data);
            if (!this.playUrls.includes(cached.data)) {
              this.playUrls.unshift(cached.data);
            }
            this.currentUrlIndex = this.playUrls.indexOf(cached.data);
            this.prematureEndCount = 0;
          }
        } catch (e) {
          // ignore
        }
      }

      // 2. 稍作等待缓冲（800ms），避免立即重连造成的连续失败
      await new Promise((resolve) => setTimeout(resolve, 800));

      if (this.isManuallyStopped) {
        this.isRecovering = false;
        return false;
      }

      // 3. 从 savedTime 恢复播放
      const currentUrl = this.playUrls[this.currentUrlIndex];
      if (!currentUrl) {
        this.isRecovering = false;
        return false;
      }

      console.log(`🔄 重新连接播放流并恢复至 ${savedTime.toFixed(1)}s:`, currentUrl);
      const success = await this.tryPlayUrl(savedTime);
      this.isRecovering = false;
      return success;
    } catch (error) {
      console.error("❌ 恢复播放失败:", error);
      this.isRecovering = false;
      return false;
    }
  }

  /**
   * 尝试播放URL
   */
  async tryPlayUrl(targetTime = 0) {
    if (this.currentUrlIndex >= this.playUrls.length) {
      console.error("🎵 所有播放地址都失败了");
      return false;
    }

    const url = this.playUrls[this.currentUrlIndex];
    console.log(
      `🎵 尝试播放地址 ${this.currentUrlIndex + 1}/${this.playUrls.length}:`,
      url,
    );

    // 检查URL是否有效
    if (!url || typeof url !== "string" || url.trim() === "") {
      console.error("❌ 播放地址无效:", url);
      return await this.handlePlaybackError();
    }

    // 检查是否是无效的wails URL
    if (url.startsWith("wails://localhost/") && url === "wails://localhost/") {
      console.error("❌ 检测到无效的wails URL:", url);
      return await this.handlePlaybackError();
    }

    try {
      this.resetPlaybackMetrics(this.currentSong, url);
      this.audio.src = url;
      this.markPlaybackMetric("srcAssigned");

      if (targetTime > 0.5) {
        const resumePos = Math.max(0, targetTime - 0.5);
        let timeSet = false;
        const setTimeHandler = () => {
          if (timeSet) return;
          timeSet = true;
          try {
            this.audio.currentTime = resumePos;
            console.log(`⏱️ 恢复播放进度已设置到: ${resumePos.toFixed(1)}s`);
          } catch (e) {
            console.warn("⚠️ 设置音频当前时间失败:", e);
          }
        };
        if (this.audio.readyState >= 1) {
          setTimeHandler();
        } else {
          this.audio.addEventListener("loadedmetadata", setTimeHandler, { once: true });
          this.audio.addEventListener("canplay", setTimeHandler, { once: true });
        }
      }

      await this.audio.play();
      this.markPlaybackMetric("playResolved");
      this.logPlaybackMetricsSummary("play-resolved");
      console.log("✅ 播放成功" + (targetTime > 0 ? ` (恢复进度: ${targetTime.toFixed(1)}s)` : ""));
      return true;
    } catch (error) {
      this.logPlaybackMetricsSummary("play-failed");
      console.error(`❌ 播放地址 ${this.currentUrlIndex + 1} 失败:`, error);
      console.error("❌ 播放错误:", error.message);
      console.error("❌ 当前URL:", url);
      if (this.isManuallyStopped) {
        console.log("⏹️ 播放已被手动停止，跳过错误处理");
        return false;
      }

      if (error?.name === "AbortError") {
        console.log("🎵 播放请求被中止 (AbortError)，忽略");
        return false;
      }

      if (error?.name === "NotAllowedError") {
        this.lastPlaybackBlockReason = "autoplay-blocked";
        this._isPlaying = false;
        console.warn("⛔ 播放被平台自动播放策略阻止，等待用户手动恢复播放");
        return false;
      }

      return await this.handlePlaybackError();
    }
  }

  /**
   * 处理播放错误
   */
  async handlePlaybackError() {
    if (this.isManuallyStopped) {
      console.log("⏹️ 播放已被手动停止，跳过错误重试");
      return false;
    }
    this.retryCount++;

    if (this.retryCount < this.maxRetries) {
      console.log(`🔄 重试播放 (${this.retryCount}/${this.maxRetries})`);
      // 🔧 内存泄漏修复：使用资源管理器管理定时器
      await new Promise((resolve) => {
        const addTimer = (callback, delay) => {
          if (this.resourceManager) {
            return this.resourceManager.addTimer(callback, delay);
          } else if (window.GlobalResourceManager) {
            return window.GlobalResourceManager.addTimer(callback, delay);
          } else {
            return setTimeout(callback, delay);
          }
        };
        addTimer(resolve, 1000);
      });
      return await this.tryPlayUrl(this.lastPlaybackPosition || 0);
    } else {
      // 尝试下一个URL
      this.currentUrlIndex++;
      this.retryCount = 0;

      if (this.currentUrlIndex < this.playUrls.length) {
        console.log("🔄 尝试下一个播放地址");
        return await this.tryPlayUrl(this.lastPlaybackPosition || 0);
      } else {
        console.error("❌ 所有播放地址都失败了");

        // 等待30秒后自动播放下一首
        console.log("🎵 所有播放地址都失败，30秒后自动播放下一首");
        const failedSongHash = this.currentSong?.hash;
        // 🔧 内存泄漏修复：使用资源管理器管理定时器
        const addTimer = (callback, delay) => {
          if (this.resourceManager) {
            return this.resourceManager.addTimer(callback, delay);
          } else if (window.GlobalResourceManager) {
            return window.GlobalResourceManager.addTimer(callback, delay);
          } else {
            return setTimeout(callback, delay);
          }
        };

        addTimer(async () => {
          // 如果当前已经在播放或切了其他歌，取消自动切歌
          if (this.isPlaying()) {
            console.log("🎵 播放器当前正在正常播放，取消错误自动切歌");
            return;
          }
          const current = this.getCurrentSong?.() || (window.PlayerController ? window.PlayerController.getCurrentSong() : null);
          if (current && failedSongHash && current.hash !== failedSongHash) {
            console.log("🎵 当前歌曲已变更，取消旧错误的自动切歌");
            return;
          }
          console.log("🎵 开始自动播放下一首（所有播放地址失败）");
          try {
            if (window.PlayerController && window.PlayerController.playNext) {
              const success = await window.PlayerController.playNext();
              if (!success) {
                console.warn("⚠️ 自动播放下一首失败，可能已到播放列表末尾");
              }
            } else {
              console.error("❌ PlayerController 不可用，无法自动播放下一首");
            }
          } catch (error) {
            console.error("❌ 自动播放下一首时出错:", error);
          }
        }, 30000);

        if (this.onErrorCallback) this.onErrorCallback();
        return false;
      }
    }
  }

  /**
   * 暂停播放
   */
  pause() {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
      console.log("⏸️ 暂停播放");
    }
  }

  /**
   * 继续播放
   */
  resume() {
    if (this.audio && this.audio.paused) {
      this.audio.play().catch((error) => {
        if (error?.name === "NotAllowedError") {
          this.lastPlaybackBlockReason = "autoplay-blocked";
          this._isPlaying = false;
          console.warn("⛔ 继续播放被平台自动播放策略阻止，等待用户手动恢复播放");
          return;
        }
        console.error("❌ 继续播放失败:", error);
      });
      console.log("▶️ 继续播放");
    }
  }
  /**
   * 将已完成下载的本地音频缓存插入播放候选第一顺位
   */
  promoteCachedUrl(cachedUrl) {
    if (!cachedUrl || this.playUrls.includes(cachedUrl)) return;
    console.log("🎵 将本地音频缓存插入播放候选第一顺位:", cachedUrl);
    this.playUrls.unshift(cachedUrl);
    this.currentUrlIndex = 0;
  }


  /**
   * 停止播放
   */
  stop() {
    this.isManuallyStopped = true;
    this.isRecovering = false;
    this.prematureEndCount = 0;
    this.lastPlaybackPosition = 0;
    if (this.audio) {
      try {
        this.audio.pause();
        if (this.audio.currentTime !== 0) {
          this.audio.currentTime = 0;
        }
      } catch (e) {
        console.warn("⚠️ 停止音频时捕获异常:", e);
      }
      this._isPlaying = false;
      console.log("⏹️ 停止播放");
    }
  }

  /**
   * 设置音量
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio) {
      this.audio.volume = this.volume;
    }
    console.log("🔊 音量设置为:", this.volume);
  }

  /**
   * 获取当前播放时间
   */
  getCurrentTime() {
    return this.audio ? this.audio.currentTime : 0;
  }

  /**
   * 获取总时长
   */
  getDuration() {
    return this.audio ? this.audio.duration : 0;
  }

  /**
   * 设置播放位置
   */
  setCurrentTime(time) {
    if (this.audio) {
      this.audio.currentTime = time;
    }
  }

  /**
   * 检查是否正在播放
   */
  isPlaying() {
    return this._isPlaying;
  }

  getLastPlaybackBlockReason() {
    return this.lastPlaybackBlockReason;
  }

  /**
   * 设置事件回调
   */
  onPlay(callback) {
    this.onPlayCallback = callback;
  }
  onPause(callback) {
    this.onPauseCallback = callback;
  }
  onEnd(callback) {
    this.onEndCallback = callback;
  }
  onError(callback) {
    this.onErrorCallback = callback;
  }
  onLoad(callback) {
    this.onLoadCallback = callback;
  }
  onTimeUpdate(callback) {
    this.onTimeUpdateCallback = callback;
  }

  /**
   * 获取当前歌曲信息
   */
  getCurrentSong() {
    return this.currentSong;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load(); // 重新加载以清除缓存
    }
    this.currentSong = null;
    this.playUrls = [];
    console.log("🎵 播放器缓存已清除");
  }
}

// ============================================================================
// 页面集成部分
// ============================================================================

// 全局播放器实例
let audioPlayer = null;

// 下一首预缓存状态
let lastPrefetchedSongHash = null;
let lastPrefetchTriggerKey = null;

// 时间更新定时器
let timeUpdateInterval = null;

// DOM 元素引用（播放控制相关）
let playPauseBtn = null;
let prevBtn = null;
let nextBtn = null;
let shuffleBtn = null;
let repeatBtn = null;
let volumeSlider = null;
let currentTimeElement = null;
let totalTimeElement = null;
let progressFillElement = null;
let progressContainerElement = null;

/**
 * 获取播放控制相关的DOM元素
 */
function getDOMElements() {
  // 确保获取主播放器的控制按钮，而不是沉浸式播放器的按钮
  const playerBar = document.querySelector(".player-bar");
  if (playerBar) {
    playPauseBtn = playerBar.querySelector(".play-pause-btn");
    prevBtn = playerBar.querySelector(".prev-btn");
    nextBtn = playerBar.querySelector(".next-btn");
    shuffleBtn = playerBar.querySelector(".shuffle-btn");
    repeatBtn = playerBar.querySelector(".repeat-btn");
    volumeSlider = playerBar.querySelector(".volume-slider");
    currentTimeElement = playerBar.querySelector(".time-current");
    totalTimeElement = playerBar.querySelector(".time-total");
    progressFillElement = playerBar.querySelector(".progress-fill");
    progressContainerElement = playerBar.querySelector(".progress-container");
  } else {
    console.error("❌ 未找到主播放器容器 (.player-bar)");
    // 回退到全局查找，但优先选择主播放器的元素
    playPauseBtn =
      document.querySelector(".player-bar .play-pause-btn") ||
      document.querySelector(".play-pause-btn");
    prevBtn =
      document.querySelector(".player-bar .prev-btn") ||
      document.querySelector(".prev-btn");
    nextBtn =
      document.querySelector(".player-bar .next-btn") ||
      document.querySelector(".next-btn");
    shuffleBtn =
      document.querySelector(".player-bar .shuffle-btn") ||
      document.querySelector(".shuffle-btn");
    repeatBtn =
      document.querySelector(".player-bar .repeat-btn") ||
      document.querySelector(".repeat-btn");
    volumeSlider =
      document.querySelector(".player-bar .volume-slider") ||
      document.querySelector(".volume-slider");
    currentTimeElement =
      document.querySelector(".player-bar .time-current") ||
      document.querySelector(".time-current");
    totalTimeElement =
      document.querySelector(".player-bar .time-total") ||
      document.querySelector(".time-total");
    progressFillElement = document.querySelector(".player-bar .progress-fill");
    progressContainerElement = document.querySelector(
      ".player-bar .progress-container",
    );
  }

  console.log("🎵 主播放器DOM元素获取完成");
  console.log(
    "🎵 播放/暂停按钮:",
    !!playPauseBtn,
    playPauseBtn ? `(${playPauseBtn.className})` : "",
  );
  console.log("🎵 上一首按钮:", !!prevBtn);
  console.log("🎵 下一首按钮:", !!nextBtn);
  console.log("🎵 随机播放按钮:", !!shuffleBtn);
  console.log("🎵 循环播放按钮:", !!repeatBtn);
  console.log("🎵 音量滑块:", !!volumeSlider);
  console.log("🎵 当前时间元素:", !!currentTimeElement);
  console.log("🎵 总时间元素:", !!totalTimeElement);
  console.log("🎵 进度条填充元素:", !!progressFillElement);
  console.log("🎵 进度条容器元素:", !!progressContainerElement);
}

/**
 * 设置播放器事件监听器
 */
function setupPlayerEventListeners() {
  // 播放/暂停按钮
  if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => {
      console.log("🎵 播放/暂停按钮被点击");
      if (window.PlayerController) {
        window.PlayerController.togglePlayPause();
      } else {
        console.error("❌ PlayerController不可用");
      }
    });
  }

  // 上一首按钮
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      console.log("🎵 上一首按钮被点击");
      if (window.PlayerController) {
        window.PlayerController.playPrevious();
      } else {
        console.error("❌ PlayerController不可用");
      }
    });
  }

  // 下一首按钮
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      console.log("🎵 下一首按钮被点击");
      if (window.PlayerController) {
        window.PlayerController.playNext();
      } else {
        console.error("❌ PlayerController不可用");
      }
    });
  }

  // 随机播放按钮
  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      console.log("🔀 随机播放按钮被点击");
      if (window.PlayerController) {
        window.PlayerController.toggleShuffle();
      } else {
        console.error("❌ PlayerController不可用");
      }
    });
  }

  // 循环播放按钮
  if (repeatBtn) {
    repeatBtn.addEventListener("click", () => {
      console.log("🔁 循环播放按钮被点击");
      if (window.PlayerController) {
        window.PlayerController.toggleRepeat();
      } else {
        console.error("❌ PlayerController不可用");
      }
    });
  }

  // 音量控制 - 使用统一控制器
  if (volumeSlider) {
    volumeSlider.addEventListener("input", (e) => {
      const volume = parseInt(e.target.value);
      if (window.UnifiedPlayerController) {
        window.UnifiedPlayerController.setVolume(volume);
      } else {
        // 降级处理
        const volumeDecimal = volume / 100;
        if (audioPlayer) {
          audioPlayer.setVolume(volumeDecimal);
        }
        if (window.setVolume) {
          window.setVolume(volumeDecimal);
        }
      }
      console.log("🔊 底栏播放器音量调整为:", volume + "%");
    });
  }

  // 进度条点击 - 绑定到进度条本身而不是容器
  const progressBarElement = document.querySelector(
    ".player-bar .progress-bar",
  );
  if (progressBarElement) {
    progressBarElement.addEventListener("click", (e) => {
      const rect = progressBarElement.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const percentage = Math.max(0, Math.min(1, clickX / width));
      const duration = audioPlayer.getDuration();

      if (duration > 0) {
        const newTime = duration * percentage;
        audioPlayer.setCurrentTime(newTime);
        console.log("🎵 进度条点击跳转到:", {
          clickX: clickX,
          width: width,
          percentage: (percentage * 100).toFixed(1) + "%",
          newTime: formatTime(newTime),
        });
      }
    });
    console.log("🎵 进度条点击事件已绑定到 progress-bar");
  } else {
    console.warn("🎵 找不到进度条元素，无法绑定点击事件");
  }
}

/**
 * 处理播放结束后的逻辑
 */
async function handlePlaybackEnd() {
  console.log("🎵 处理播放结束逻辑");

  // 终极安全守护：严格检查当前播放进度与歌曲时长
  const player = window.audioPlayer ? window.audioPlayer() : null;
  if (player && player.audio) {
    const currentTime = (player.audio.currentTime > 0)
      ? player.audio.currentTime
      : (player.lastPlaybackPosition || 0);
    const audioDuration = (player.audio.duration > 0 && Number.isFinite(player.audio.duration))
      ? player.audio.duration
      : 0;
    const song = player.currentSong || (window.PlayerController ? window.PlayerController.getCurrentSong() : null);
    const songDuration = Number(song?.time_length || song?.duration || 0) || 0;

    let expectedDuration = audioDuration;
    if (songDuration > 10) {
      if (expectedDuration <= 0 || expectedDuration < songDuration - 10) {
        expectedDuration = songDuration;
      }
    }

    // 关键拦截：如果歌曲预期总时长大于10秒，但当前播放进度距离末尾超过5秒，且不足95%，
    // 说明是网络抖动、流中断等原因导致的虚假结束，绝不能自动切下一首！
    if (expectedDuration > 10 && currentTime < (expectedDuration - 5) && (currentTime / expectedDuration < 0.95)) {
      console.warn(`⚠️ handlePlaybackEnd 拦截虚假结束: 当前进度 ${currentTime.toFixed(1)}s 远小于总时长 ${expectedDuration.toFixed(1)}s，忽略切歌请求`);
      return;
    }
  }

  const currentPlaylist = window.PlaylistManager
    ? window.PlaylistManager.getCurrentPlaylist()
    : null;
  const playlistName = currentPlaylist?.name || "";
  const endless = playlistName === "私人FM" || playlistName === "AI推荐";

  if (endless) {
    const idx =
      currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? 0;
    const total = currentPlaylist.songs?.length || 0;
    if (total > 0 && idx >= total - 1 && window.extendEndlessPlaylist) {
      await window.extendEndlessPlaylist(playlistName);
    }
    if (window.PlayerController?.playNext) {
      await window.PlayerController.playNext();
    }
    return;
  }

  // 检查是否有播放列表管理器和播放控制器
  if (!window.PlaylistManager || !window.PlayerController) {
    console.log("⚠️ 播放列表管理器或播放控制器不可用，无法自动播放下一首");
    return;
  }

  try {
    const currentPlaylist = window.PlaylistManager.getCurrentPlaylist();
    console.log("🎵 当前播放列表:", currentPlaylist);
    console.log("🎵 当前播放索引:", currentPlaylist.current_index);
    console.log("🎵 播放列表长度:", currentPlaylist.songs?.length || 0);
    console.log("🎵 循环模式:", currentPlaylist.repeat_mode);
    console.log("🎵 随机模式:", currentPlaylist.shuffle_mode);

    // 根据播放模式决定下一步操作
    // 首先检查是否是单曲循环
    if (currentPlaylist.repeat_mode === "one") {
      // 单曲循环：重新播放当前歌曲
      console.log("🔁 单曲循环：重新播放当前歌曲");
      // 🔧 内存泄漏修复：使用全局资源管理器管理定时器
      if (window.GlobalResourceManager) {
        window.GlobalResourceManager.addTimer(() => {
          window.PlayerController.playCurrentSong();
        }, 500);
      } else {
        setTimeout(() => {
          window.PlayerController.playCurrentSong();
        }, 500);
      }
    } else if (currentPlaylist.shuffle_mode) {
      // 随机播放：总是有下一首（会重新生成随机顺序）
      console.log("🔀 随机播放：播放下一首随机歌曲");
      // 🔧 内存泄漏修复：使用全局资源管理器管理定时器
      if (window.GlobalResourceManager) {
        window.GlobalResourceManager.addTimer(() => {
          window.PlayerController.playNext();
        }, 500);
      } else {
        setTimeout(() => {
          window.PlayerController.playNext();
        }, 500);
      }
    } else if (currentPlaylist.repeat_mode === "all") {
      // 列表循环：总是有下一首（播放完最后一首回到第一首）
      console.log("🔁 列表循环：播放下一首歌曲");
      // 🔧 内存泄漏修复：使用全局资源管理器管理定时器
      if (window.GlobalResourceManager) {
        window.GlobalResourceManager.addTimer(() => {
          window.PlayerController.playNext();
        }, 500);
      } else {
        setTimeout(() => {
          window.PlayerController.playNext();
        }, 500);
      }
    } else {
      // 正常播放（repeat_mode === 'off'）：检查是否有下一首
      if (window.PlaylistManager.hasNext()) {
        console.log("⏭️ 正常播放：播放下一首歌曲");
        // 🔧 内存泄漏修复：使用全局资源管理器管理定时器
        if (window.GlobalResourceManager) {
          window.GlobalResourceManager.addTimer(() => {
            window.PlayerController.playNext();
          }, 500);
        } else {
          setTimeout(() => {
            window.PlayerController.playNext();
          }, 500);
        }
      } else {
        console.log("🎵 正常播放：已播放完所有歌曲，停止播放");
      }
    }
  } catch (error) {
    console.error("❌ 处理播放结束逻辑时出错:", error);
  }
}

/**
 * 设置播放器回调
 */
function setupPlayerCallbacks() {
  // 播放开始回调
  audioPlayer.onPlay(() => {
    const currentSong = audioPlayer.getCurrentSong();
    lastPrefetchedSongHash = null;
    lastPrefetchTriggerKey = currentSong?.hash || null;
    updatePlayerBar();
    startTimeUpdateInterval();
  });

  // 暂停回调
  audioPlayer.onPause(() => {
    updatePlayerBar();
    stopTimeUpdateInterval();
  });

  // 播放结束回调
  audioPlayer.onEnd(() => {
    console.log("🎵 HTML5播放器：播放结束");
    stopTimeUpdateInterval();
    updatePlayerBar();

    // 播放结束后根据播放模式自动播放下一首
    handlePlaybackEnd();
  });

  // 错误回调
  audioPlayer.onError(() => {
    console.error("🎵 播放器错误");
    updatePlayerBar();

    // 等待30秒后自动播放下一首
    console.log("🎵 播放器错误，30秒后自动播放下一首");
    const failedSongHash = audioPlayer.getCurrentSong?.()?.hash;
    // 🔧 内存泄漏修复：使用全局资源管理器管理定时器
    const addTimer = (callback, delay) => {
      if (window.GlobalResourceManager) {
        return window.GlobalResourceManager.addTimer(callback, delay);
      } else {
        return setTimeout(callback, delay);
      }
    };
    addTimer(async () => {
      if (audioPlayer.isPlaying && audioPlayer.isPlaying()) {
        console.log("🎵 播放器当前正在正常播放，取消错误自动切歌");
        return;
      }
      const current = audioPlayer.getCurrentSong?.() || (window.PlayerController ? window.PlayerController.getCurrentSong() : null);
      if (current && failedSongHash && current.hash !== failedSongHash) {
        console.log("🎵 当前歌曲已变更，取消旧错误的自动切歌");
        return;
      }
      console.log("🎵 开始自动播放下一首（播放器错误）");
      try {
        if (window.PlayerController && window.PlayerController.playNext) {
          const success = await window.PlayerController.playNext();
          if (!success) {
            console.warn("⚠️ 自动播放下一首失败，可能已到播放列表末尾");
          }
        } else {
          console.error("❌ PlayerController 不可用，无法自动播放下一首");
        }
      } catch (error) {
        console.error("❌ 自动播放下一首时出错:", error);
      }
    }, 30000);
  });

  // 时间更新回调
  audioPlayer.onTimeUpdate((currentTime, duration) => {
    updateTimeDisplay(currentTime, duration);
    updateProgressBar(currentTime, duration);
    // 更新歌词高亮
    if (window.updateLyricsHighlight) {
      window.updateLyricsHighlight(currentTime);
    }

    void maybePrefetchNextSong(currentTime, duration);
  });
}

async function maybePrefetchNextSong(currentTime, duration) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 10) {
    return;
  }

  const remainingTime = duration - currentTime;
  if (remainingTime > 10) {
    return;
  }

  const currentSong = audioPlayer?.getCurrentSong?.();
  const currentSongHash = currentSong?.hash || null;
  if (!currentSongHash) {
    return;
  }

  // 同一首歌只触发一次预缓存
  if (lastPrefetchTriggerKey === currentSongHash && lastPrefetchedSongHash) {
    return;
  }

  if (!window.PlaylistManager?.peekNextSong) {
    return;
  }

  const nextSong = window.PlaylistManager.peekNextSong();
  const nextSongHash = nextSong?.hash;
  if (!nextSongHash || nextSongHash === lastPrefetchedSongHash) {
    return;
  }

  try {
    console.log('🎵 开始预缓存下一首歌曲:', nextSong.songname || nextSongHash);

    const { GetCachedURL, CacheAudioFile } = await import('./bindings/wmplayer/cacheservice.js');
    const cachedResponse = await GetCachedURL(nextSongHash);
    if (cachedResponse?.success && cachedResponse?.data) {
      console.log('✅ 下一首歌曲已存在缓存，跳过预缓存:', nextSong.songname || nextSongHash);
      lastPrefetchedSongHash = nextSongHash;
      lastPrefetchTriggerKey = currentSongHash;
      return;
    }

    const { GetSongUrl } = await import('./bindings/wmplayer/homepageservice.js');
    const nextSongUrlResponse = await GetSongUrl(nextSongHash);
    if (!nextSongUrlResponse?.success || !nextSongUrlResponse?.data) {
      console.warn('⚠️ 下一首歌曲播放地址获取失败，跳过预缓存:', nextSong.songname || nextSongHash);
      return;
    }

    const nextUrls = normalizeSongUrls(nextSongUrlResponse.data);
    if (nextUrls.length === 0) {
      console.warn('⚠️ 下一首歌曲没有可用播放地址，跳过预缓存:', nextSong.songname || nextSongHash);
      return;
    }

    const cacheResponse = await CacheAudioFile(nextSongHash, nextUrls);
    if (cacheResponse?.success) {
      console.log('✅ 下一首歌曲预缓存成功:', nextSong.songname || nextSongHash);
      lastPrefetchedSongHash = nextSongHash;
      lastPrefetchTriggerKey = currentSongHash;
      return;
    }

    console.warn('⚠️ 下一首歌曲预缓存失败:', cacheResponse?.message || '未知错误');
  } catch (error) {
    console.error('❌ 预缓存下一首歌曲失败:', error);
  }
}

/**
 * 开始时间更新定时器
 */
function startTimeUpdateInterval() {
  stopTimeUpdateInterval(); // 先清除现有的定时器

  // 🔧 内存泄漏修复：使用全局资源管理器管理定时器
  if (window.GlobalResourceManager) {
    timeUpdateInterval = window.GlobalResourceManager.addInterval(() => {
      const currentTime = audioPlayer.getCurrentTime();
      const duration = audioPlayer.getDuration();
      updateTimeDisplay(currentTime, duration);
      updateProgressBar(currentTime, duration);
      // 更新歌词高亮
      if (window.updateLyricsHighlight) {
        window.updateLyricsHighlight(currentTime);
      } else {
        if (!window._lyricsWarningShown) {
          console.warn("🎵 updateLyricsHighlight 函数不可用");
          window._lyricsWarningShown = true;
        }
      }
    }, 60); // 60ms高频同步，毫秒级精度杜绝歌词延后
  } else {
    timeUpdateInterval = setInterval(() => {
      const currentTime = audioPlayer.getCurrentTime();
      const duration = audioPlayer.getDuration();
      updateTimeDisplay(currentTime, duration);
      updateProgressBar(currentTime, duration);
      // 更新歌词高亮
      if (window.updateLyricsHighlight) {
        window.updateLyricsHighlight(currentTime);
      } else {
        if (!window._lyricsWarningShown) {
          console.warn("🎵 updateLyricsHighlight 函数不可用");
          window._lyricsWarningShown = true;
        }
      }
    }, 60);
  }
}

/**
 * 停止时间更新定时器
 */
function stopTimeUpdateInterval() {
  if (timeUpdateInterval) {
    // 🔧 内存泄漏修复：使用全局资源管理器清理定时器
    if (window.GlobalResourceManager) {
      window.GlobalResourceManager.removeInterval(timeUpdateInterval);
    } else {
      clearInterval(timeUpdateInterval);
    }
    timeUpdateInterval = null;
  }
}

/**
 * 更新时间显示
 */
function updateTimeDisplay(currentTime, duration) {
  if (currentTimeElement) {
    currentTimeElement.textContent = formatTime(currentTime);
  }

  if (totalTimeElement && duration > 0) {
    totalTimeElement.textContent = formatTime(duration);
  }
}

/**
 * 更新进度条
 */
function updateProgressBar(currentTime, duration) {
  if (!progressFillElement || duration <= 0) {
    return;
  }

  const progress = Math.max(0, Math.min(1, currentTime / duration));
  const percentage = (progress * 100).toFixed(1);

  // 更新进度条（使用width属性保持圆角）
  progressFillElement.style.width = `${percentage}%`;

  // console.log(`🎵 进度条更新: ${percentage}% (${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s)`);
}

/**
 * 格式化时间
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * 更新播放器状态栏
 */
function updatePlayerBar() {
  // 更新播放/暂停按钮
  if (playPauseBtn) {
    const icon = playPauseBtn.querySelector("i");
    if (icon) {
      if (audioPlayer.isPlaying()) {
        icon.className = "fas fa-pause";
        playPauseBtn.title = "暂停";
      } else {
        icon.className = "fas fa-play";
        playPauseBtn.title = "播放";
      }
    }
  }

  console.log("🎵 播放器状态栏已更新");
}

/**
 * 播放歌曲（兼容性函数，直接调用播放器的play方法）
 */
async function playSong(song, urls) {
  if (!audioPlayer) {
    console.error("🎵 播放器未初始化");
    return;
  }

  console.log("🎵 播放歌曲请求:", song);

  // 直接播放音频，歌曲信息更新由play方法内部处理
  await audioPlayer.play(song, urls);
}

/**
 * 全局统一的歌曲信息格式化函数
 * 提供标准化的歌曲信息显示格式，支持多种字段备选方案
 */
window.formatSongInfo = function (song) {
  if (!song)
    return {
      songname: "未知歌曲",
      author_name: "未知艺术家",
      album_name: "未知专辑",
      union_cover: "",
      hash: "",
      time_length: 0,
    };

  return {
    songname:
      song.songname || song.title || song.name || song.filename || "未知歌曲",
    author_name: song.author_name || "未知艺术家",
    album_name: song.album_name || "未知专辑",
    union_cover: song.union_cover || "",
    hash: song.hash || "",
    time_length: song.time_length || 0,
  };
};

/**
 * 简洁的播放器左侧信息更新函数
 */
function updateSongInfo(song) {
  console.log("🎵 更新播放器左侧信息");
  console.log("🎵 歌曲数据:", {
    songname: song?.songname,
    author_name: song?.author_name,
    union_cover: song?.union_cover,
  });

  if (!song) {
    console.error("❌ 歌曲对象为空");
    return;
  }

  // 直接查找元素，不使用全局变量
  const songNameElement = document.querySelector(".player-bar .songname");
  const artistElement = document.querySelector(".player-bar .author_name");
  const coverElement = document.querySelector(".player-bar .song-cover");

  console.log("🎵 DOM元素状态:", {
    songNameElement: !!songNameElement,
    artistElement: !!artistElement,
    coverElement: !!coverElement,
  });

  // 使用全局统一的歌曲信息格式化函数
  const formattedInfo = window.formatSongInfo(song);

  // 更新歌曲名称
  if (songNameElement) {
    console.log("🔍 歌名字段详细检查:", {
      song对象: song,
      "song.songname": song.songname,
      "song.title": song.title,
      "song.name": song.name,
      "song.filename": song.filename,
      songname类型: typeof song.songname,
      songname长度: song.songname ? song.songname.length : 0,
      最终显示的歌名: formattedInfo.songname,
    });
    songNameElement.textContent = formattedInfo.songname;
    console.log("✅ 歌曲名称已更新:", formattedInfo.songname);
    console.log("✅ DOM元素内容确认:", songNameElement.textContent);
  }

  // 更新艺术家
  if (artistElement) {
    artistElement.textContent = formattedInfo.author_name;
    console.log("✅ 艺术家已更新:", formattedInfo.author_name);
  }

  // 更新封面 - 使用 union_cover 字段
  if (coverElement) {
    const union_cover = song.union_cover;
    if (union_cover) {
      const processedUrl = union_cover.replace("{size}", "56");
      coverElement.innerHTML = `<img src="${processedUrl}" alt="歌曲封面" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
      console.log("✅ 封面已更新:", processedUrl);
    } else {
      coverElement.innerHTML =
        '<div class="cover-placeholder"><i class="fas fa-music"></i></div>';
      console.log("✅ 显示默认封面");
    }
  }

  console.log("🎵 播放器左侧信息更新完成");

  // 绑定事件到播放器界面（如果需要）
}

/**
 * 暂停音频
 */
function pauseAudio() {
  if (audioPlayer) {
    audioPlayer.pause();
  }
}

/**
 * 停止音频
 */
function stopAudio() {
  if (audioPlayer) {
    audioPlayer.stop();
  }
}

/**
 * 设置音量
 */
function setVolume(volume) {
  if (audioPlayer) {
    audioPlayer.setVolume(volume);
  }
}

/**
 * 获取当前歌曲
 */
function getCurrentSong() {
  return audioPlayer ? audioPlayer.getCurrentSong() : null;
}

/**
 * 立即初始化播放器核心，DOM相关功能延迟初始化
 */
function initializePlayerCore() {
  console.log("🎵 立即初始化 HTML5 Audio 播放器核心...");

  // 🔧 内存泄漏修复：添加单例保护，防止重复创建播放器实例
  if (audioPlayer) {
    console.log("🎵 播放器实例已存在，先销毁旧实例");
    try {
      audioPlayer.destroy();
    } catch (error) {
      console.warn("⚠️ 销毁旧播放器实例时出错:", error);
    }
    audioPlayer = null;
  }

  // 创建播放器实例
  audioPlayer = new HTML5AudioPlayer();

  console.log("🎵 HTML5 Audio 播放器核心初始化完成");
}

/**
 * DOM加载完成后初始化UI相关功能
 */
document.addEventListener("DOMContentLoaded", () => {
  console.log("🎵 DOM 加载完成，初始化 HTML5 Audio 播放器UI功能");

  // 如果播放器还没有初始化，先初始化核心
  if (!audioPlayer) {
    initializePlayerCore();
  }

  // 获取DOM元素
  getDOMElements();

  // 设置事件监听器
  setupPlayerEventListeners();

  // 设置播放器事件回调
  setupPlayerCallbacks();

  // 初始化音量图标显示
  if (window.UnifiedPlayerController) {
    const currentVolume = window.UnifiedPlayerController.getVolume();
    updateVolumeIcon(currentVolume / 100);
  } else {
    // 默认音量50%
    updateVolumeIcon(0.5);
  }

  console.log("🎵 HTML5 Audio 播放器UI功能初始化完成");
});

// 立即初始化播放器核心
initializePlayerCore();

// ============================================================================
// 全局函数暴露
// ============================================================================

// 暴露播放器实例
window.audioPlayer = () => audioPlayer;
window.HTML5AudioPlayer = HTML5AudioPlayer;

// 暴露播放器控制函数
window.updatePlayerBar = updatePlayerBar;
window.updateSongInfo = updateSongInfo;
window.playSong = playSong;
window.pauseAudio = pauseAudio;
window.stopAudio = stopAudio;
window.setVolume = setVolume;
window.getCurrentSong = getCurrentSong;

// 测试播放器进度条
window.testProgress = (percentage = 50) => {
  // 测试播放器进度条（width方式保持圆角）
  const progressFill = document.querySelector(".player-bar .progress-fill");
  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
    console.log(`🧪 播放器进度条测试: 设置为 ${percentage}%`);
    return `播放器进度条已设置为 ${percentage}%`;
  } else {
    console.error("🧪 找不到播放器进度条元素");
    return "找不到播放器进度条元素";
  }
};

// 更新音量图标显示
function updateVolumeIcon(volume) {
  const volumeIcon = document.querySelector(".player-bar .volume-btn i");
  if (volumeIcon) {
    if (volume === 0) {
      volumeIcon.className = "fas fa-volume-mute";
    } else if (volume < 0.4) {
      volumeIcon.className = "fas fa-volume-down";
    } else if (volume < 0.7) {
      volumeIcon.className = "fas fa-volume";
    } else {
      volumeIcon.className = "fas fa-volume-up";
    }
    console.log("🔊 底栏音量图标更新:", volume, volumeIcon.className);
  } else {
    console.warn("⚠️ 找不到底栏音量图标元素");
  }
}

// 监听统一控制器事件
function setupUnifiedControllerListeners() {
  if (!window.UnifiedPlayerController) {
    console.warn("⚠️ 统一播放器控制器未加载，跳过事件监听设置");
    return;
  }

  // 监听音量变化
  window.UnifiedPlayerController.on("volumeChanged", (data) => {
    console.log("🔊 底栏播放器收到音量变化事件:", data.volume + "%");

    // 更新音量滑块
    if (volumeSlider) {
      volumeSlider.value = data.volume;
    }

    // 更新音量图标
    updateVolumeIcon(data.volume / 100);
  });

  // 监听静音状态变化
  window.UnifiedPlayerController.on("muteStateChanged", (isMuted) => {
    console.log(
      "🔇 底栏播放器收到静音状态变化:",
      isMuted ? "静音" : "取消静音",
    );
    updateVolumeIcon(
      isMuted ? 0 : window.UnifiedPlayerController.getVolume() / 100,
    );
  });

  // 监听播放状态变化
  window.UnifiedPlayerController.on("playStateChanged", (isPlaying) => {
    console.log("▶️ 底栏播放器收到播放状态变化:", isPlaying ? "播放" : "暂停");
    updatePlayPauseButton(isPlaying);
  });

  // 监听歌曲变化
  window.UnifiedPlayerController.on("songChanged", (data) => {
    console.log(
      "🎵 底栏播放器收到歌曲变化事件:",
      data.currentSong?.title || data.currentSong?.songname,
    );
    if (data.currentSong) {
      updateSongInfo(data.currentSong);
    }
  });

  console.log("✅ 底栏播放器统一控制器事件监听已设置");

  // 初始化音量图标显示
  const currentVolume = window.UnifiedPlayerController.getVolume();
  updateVolumeIcon(currentVolume / 100);
  console.log("🔊 底栏音量图标初始化:", currentVolume + "%");
}

// 延迟设置事件监听，确保统一控制器已初始化
setTimeout(setupUnifiedControllerListeners, 100);

console.log("🎵 HTML5 音频播放器统一版本加载完成");
