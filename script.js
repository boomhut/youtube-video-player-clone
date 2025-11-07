const PLAYER_NAME = "Logicos Video Player"
const PLAYER_VERSION = "1.0"
const MODAL_FOCUSABLE_SELECTOR =
  "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"

// Global cache shared across all players
const sourceMetaCache = new Map()
const pendingSourceMeta = new Map()

const leadingZeroFormatter = new Intl.NumberFormat(undefined, {
  minimumIntegerDigits: 2,
})

class VideoPlayer {
  constructor(containerElement) {
    this.container = containerElement
    this.video = containerElement.querySelector("video")
    
    // Get all control elements within this container
    this.controls = {
      playPauseBtn: containerElement.querySelector(".play-pause-btn"),
      theaterBtn: containerElement.querySelector(".theater-btn"),
      fullScreenBtn: containerElement.querySelector(".full-screen-btn"),
      miniPlayerBtn: containerElement.querySelector(".mini-player-btn"),
      muteBtn: containerElement.querySelector(".mute-btn"),
      captionsBtn: containerElement.querySelector(".captions-btn"),
      speedBtn: containerElement.querySelector(".speed-btn"),
      currentTimeElem: containerElement.querySelector(".current-time"),
      totalTimeElem: containerElement.querySelector(".total-time"),
      previewImg: containerElement.querySelector(".preview-img"),
      thumbnailImg: containerElement.querySelector(".thumbnail-img"),
      volumeSlider: containerElement.querySelector(".volume-slider"),
      timelineContainer: containerElement.querySelector(".timeline-container"),
    }
    
    // Player state
    this.isScrubbing = false
    this.wasPaused = false
    this.isContextMenuOpen = false
    this.isAboutModalOpen = false
    this.lastFocusBeforeModal = null
    this.techStatusMessage = ""
    this.techStatusIsError = false
    this.captions = this.video.textTracks[0]
    
    // Create context menu and modal for this player
    this.contextMenu = this.createContextMenu()
    this.contextMenuItems = Array.from(
      this.contextMenu.querySelectorAll("[data-action]")
    )
    
    const modalComponents = this.createAboutModal()
    this.aboutOverlay = modalComponents.overlay
    this.aboutDialog = modalComponents.dialog
    this.aboutCloseButton = modalComponents.closeButton
    this.aboutMetaList = modalComponents.metaList
    this.aboutDescription = modalComponents.description
    this.aboutTechToggle = modalComponents.techToggle
    this.aboutTechPanel = modalComponents.techPanel
    this.aboutTechStatus = modalComponents.techStatus
    
    // Initialize
    this.initializePlayer()
  }
  
  initializePlayer() {
    // Setup captions
    if (this.captions) this.captions.mode = "hidden"
    
    // Bind all event listeners
    this.bindKeyboardEvents()
    this.bindTimelineEvents()
    this.bindControlEvents()
    this.bindVideoEvents()
    this.bindContextMenuEvents()
    this.bindModalEvents()
  }
  
  bindKeyboardEvents() {
    // Only respond to keyboard shortcuts when this player's container or video is focused
    this.container.addEventListener("keydown", (e) => {
      const tagName = document.activeElement.tagName.toLowerCase()
      if (tagName === "input") return
      
      switch (e.key.toLowerCase()) {
        case " ":
          if (tagName === "button") return
        case "k":
          this.togglePlay()
          break
        case "f":
          this.toggleFullScreenMode()
          break
        case "t":
          this.toggleTheaterMode()
          break
        case "i":
          this.toggleMiniPlayerMode()
          break
        case "m":
          this.toggleMute()
          break
        case "arrowleft":
        case "j":
          this.skip(-5)
          break
        case "arrowright":
        case "l":
          this.skip(5)
          break
        case "c":
          this.toggleCaptions()
          break
      }
    })
  }
  
  bindTimelineEvents() {
    const timeline = this.controls.timelineContainer
    
    timeline.addEventListener("mousemove", (e) => this.handleTimelineUpdate(e))
    timeline.addEventListener("mousedown", (e) => this.toggleScrubbing(e))
    
    document.addEventListener("mouseup", (e) => {
      if (this.isScrubbing) this.toggleScrubbing(e)
    })
    
    document.addEventListener("mousemove", (e) => {
      if (this.isScrubbing) this.handleTimelineUpdate(e)
    })
  }
  
  bindControlEvents() {
    const c = this.controls
    
    c.playPauseBtn.addEventListener("click", () => this.togglePlay())
    c.speedBtn.addEventListener("click", () => this.changePlaybackSpeed())
    c.captionsBtn.addEventListener("click", () => this.toggleCaptions())
    c.muteBtn.addEventListener("click", () => this.toggleMute())
    c.theaterBtn.addEventListener("click", () => this.toggleTheaterMode())
    c.fullScreenBtn.addEventListener("click", () => this.toggleFullScreenMode())
    c.miniPlayerBtn.addEventListener("click", () => this.toggleMiniPlayerMode())
    
    c.volumeSlider.addEventListener("input", (e) => {
      this.video.volume = e.target.value
      this.video.muted = e.target.value === 0
    })
  }
  
  bindVideoEvents() {
    this.video.addEventListener("loadeddata", () => {
      if (Number.isFinite(this.video.duration)) {
        this.controls.totalTimeElem.textContent = this.formatDuration(this.video.duration)
      }
    })
    
    this.video.addEventListener("timeupdate", () => {
      this.controls.currentTimeElem.textContent = this.formatDuration(this.video.currentTime)
      const percent = this.video.currentTime / this.video.duration
      this.controls.timelineContainer.style.setProperty("--progress-position", percent)
      if (this.isAboutModalOpen) this.updateAboutModalContent()
    })
    
    this.video.addEventListener("volumechange", () => {
      this.controls.volumeSlider.value = this.video.volume
      let volumeLevel
      if (this.video.muted || this.video.volume === 0) {
        this.controls.volumeSlider.value = 0
        volumeLevel = "muted"
      } else if (this.video.volume >= 0.5) {
        volumeLevel = "high"
      } else {
        volumeLevel = "low"
      }
      this.container.dataset.volumeLevel = volumeLevel
      if (this.isAboutModalOpen) this.updateAboutModalContent()
    })
    
    this.video.addEventListener("play", () => {
      this.container.classList.remove("paused")
    })
    
    this.video.addEventListener("pause", () => {
      this.container.classList.add("paused")
    })
    
    this.video.addEventListener("click", () => this.togglePlay())
    
    this.video.addEventListener("enterpictureinpicture", () => {
      this.container.classList.add("mini-player")
      if (this.isAboutModalOpen) this.updateAboutModalContent()
    })
    
    this.video.addEventListener("leavepictureinpicture", () => {
      this.container.classList.remove("mini-player")
      if (this.isAboutModalOpen) this.updateAboutModalContent()
    })
    
    this.video.addEventListener("loadedmetadata", () => {
      if (this.isAboutModalOpen) {
        this.updateAboutModalContent()
        this.ensureTechMetadata({ showStatus: this.isTechPanelExpanded() })
      }
    })
  }
  
  bindContextMenuEvents() {
    this.container.addEventListener("contextmenu", (e) => this.showContextMenu(e))
    this.contextMenu.addEventListener("click", (e) => this.handleContextMenuClick(e))
    this.contextMenu.addEventListener("keydown", () => this.handleContextMenuKeyboard())
    
    const pointerInputEvents = ["pointermove", "pointerdown", "wheel"]
    pointerInputEvents.forEach(eventType => {
      this.contextMenu.addEventListener(eventType, () => {
        if (this.contextMenu.dataset.inputMethod !== "pointer") {
          const activeEl = document.activeElement
          if (activeEl && this.contextMenu.contains(activeEl)) {
            activeEl.blur()
          }
        }
        this.contextMenu.dataset.inputMethod = "pointer"
      }, { passive: true })
    })
    
    // Global click handler for hiding context menu
    document.addEventListener("click", (e) => this.handleDocumentClick(e))
    
    // Global keyboard handler
    document.addEventListener("keydown", (e) => this.handleGlobalKeydown(e))
    
    window.addEventListener("resize", () => this.hideContextMenu())
    document.addEventListener("scroll", () => this.hideContextMenu(), true)
  }
  
  bindModalEvents() {
    this.aboutCloseButton.addEventListener("click", () => this.closeAboutModal())
    this.aboutOverlay.addEventListener("click", (e) => this.handleOverlayClick(e))
    document.addEventListener("focusin", (e) => this.keepFocusInsideModal(e))
    
    if (this.aboutTechToggle) {
      this.aboutTechToggle.addEventListener("click", () => this.toggleTechPanel())
    }
    
    // Fullscreen change event
    document.addEventListener("fullscreenchange", () => {
      const isFullscreen = Boolean(document.fullscreenElement === this.container)
      this.container.classList.toggle("full-screen", isFullscreen)
      if (this.isAboutModalOpen) this.updateAboutModalContent()
    })
  }
  
  // Timeline methods
  toggleScrubbing(e) {
    const rect = this.controls.timelineContainer.getBoundingClientRect()
    const percent = Math.min(Math.max(0, e.x - rect.x), rect.width) / rect.width
    this.isScrubbing = (e.buttons & 1) === 1
    this.container.classList.toggle("scrubbing", this.isScrubbing)
    if (this.isScrubbing) {
      this.wasPaused = this.video.paused
      this.video.pause()
    } else {
      this.video.currentTime = percent * this.video.duration
      if (!this.wasPaused) this.video.play()
    }
    this.handleTimelineUpdate(e)
  }
  
  handleTimelineUpdate(e) {
    const rect = this.controls.timelineContainer.getBoundingClientRect()
    const percent = Math.min(Math.max(0, e.x - rect.x), rect.width) / rect.width
    const previewImgNumber = Math.max(
      1,
      Math.floor((percent * this.video.duration) / 10)
    )
    const previewImgSrc = `assets/preview/masterclass_de_kracht_vh_ouderschapsplan-20240321_preview${previewImgNumber}.jpg`
    this.controls.previewImg.src = previewImgSrc
    this.controls.timelineContainer.style.setProperty("--preview-position", percent)
    if (this.isScrubbing) {
      e.preventDefault()
      this.controls.thumbnailImg.src = previewImgSrc
      this.controls.timelineContainer.style.setProperty("--progress-position", percent)
    }
  }
  
  // Playback controls
  togglePlay() {
    this.video.paused ? this.video.play() : this.video.pause()
  }
  
  skip(duration) {
    this.video.currentTime += duration
  }
  
  changePlaybackSpeed() {
    let newPlaybackRate = this.video.playbackRate + 0.25
    if (newPlaybackRate > 2) newPlaybackRate = 0.25
    this.video.playbackRate = newPlaybackRate
    this.controls.speedBtn.textContent = `${newPlaybackRate}×`
    if (this.isAboutModalOpen) this.updateAboutModalContent()
  }
  
  toggleCaptions() {
    if (!this.captions) return
    const isHidden = this.captions.mode === "hidden"
    this.captions.mode = isHidden ? "showing" : "hidden"
    this.container.classList.toggle("captions", isHidden)
    if (this.isAboutModalOpen) this.updateAboutModalContent()
  }
  
  toggleMute() {
    this.video.muted = !this.video.muted
  }
  
  toggleTheaterMode() {
    this.container.classList.toggle("theater")
    if (this.isAboutModalOpen) this.updateAboutModalContent()
  }
  
  toggleFullScreenMode() {
    if (document.fullscreenElement === this.container) {
      document.exitFullscreen()
    } else {
      this.container.requestFullscreen()
    }
  }
  
  toggleMiniPlayerMode() {
    if (this.container.classList.contains("mini-player")) {
      document.exitPictureInPicture()
    } else {
      this.video.requestPictureInPicture()
    }
  }
  
  // Context menu methods
  createMenuItem(label, shortcut, action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'context-menu-item'
    button.dataset.action = action

    const labelSpan = document.createElement('span')
    labelSpan.className = 'menu-label'
    labelSpan.textContent = label

    const shortcutSpan = document.createElement('span')
    shortcutSpan.className = 'menu-shortcut'
    shortcutSpan.textContent = shortcut

    button.append(labelSpan, shortcutSpan)
    return button
  }

  createContextMenu() {
    const menu = document.createElement('div')
    menu.className = 'video-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-hidden', 'true')
    menu.dataset.inputMethod = 'keyboard'

    const items = [
      ['Play', 'K', 'togglePlay'],
      ['Mute', 'M', 'toggleMute'],
      ['Playback Speed 1×', 'Shift + >', 'changeSpeed'],
      ['Turn On Captions', 'C', 'toggleCaptions'],
      'hr',
      ['Enter Theater Mode', 'T', 'toggleTheater'],
      ['Enter Full Screen', 'F', 'toggleFullScreen'],
      ['Enter Picture-in-Picture', 'I', 'toggleMiniPlayer'],
      'hr',
      [`About ${PLAYER_NAME}`, '—', 'showAbout'],
    ]

    for (const item of items) {
      if (item === 'hr') {
        menu.appendChild(document.createElement('hr'))
      } else {
        const [label, shortcut, action] = item
        menu.appendChild(this.createMenuItem(label, shortcut, action))
      }
    }

    menu.style.display = 'none'
    menu._playerInstance = this
    document.body.appendChild(menu)
    return menu
  }
  
  showContextMenu(e) {
    e.preventDefault()
    
    // Hide any other open context menus
    document.querySelectorAll(".video-context-menu.is-open").forEach(menu => {
      if (menu !== this.contextMenu) {
        menu.classList.remove("is-open")
        menu.style.display = "none"
        menu.setAttribute("aria-hidden", "true")
      }
    })
    
    const triggeredByKeyboard = e.button === 0
    this.contextMenu.dataset.inputMethod = triggeredByKeyboard ? "keyboard" : "pointer"
    if (!triggeredByKeyboard) {
      const activeEl = document.activeElement
      if (activeEl && this.contextMenu.contains(activeEl)) {
        activeEl.blur()
      }
    }
    this.updateContextMenuLabels()
    this.contextMenu.style.display = "block"
    this.contextMenu.classList.add("is-open")
    this.contextMenu.setAttribute("aria-hidden", "false")
    this.contextMenu.style.left = "0px"
    this.contextMenu.style.top = "0px"
    const menuRect = this.contextMenu.getBoundingClientRect()
    let x = e.clientX
    let y = e.clientY
    const viewportPadding = 8
    if (x + menuRect.width > window.innerWidth - viewportPadding) {
      x = window.innerWidth - menuRect.width - viewportPadding
    }
    if (y + menuRect.height > window.innerHeight - viewportPadding) {
      y = window.innerHeight - menuRect.height - viewportPadding
    }
    x = Math.max(viewportPadding, x)
    y = Math.max(viewportPadding, y)
    this.contextMenu.style.left = `${x}px`
    this.contextMenu.style.top = `${y}px`
    this.isContextMenuOpen = true
    if (triggeredByKeyboard) {
      const firstEnabledItem = this.contextMenuItems.find(item => !item.disabled)
      firstEnabledItem?.focus({ preventScroll: true })
    }
  }
  
  hideContextMenu() {
    if (!this.isContextMenuOpen) return
    this.isContextMenuOpen = false
    const activeEl = document.activeElement
    if (activeEl && this.contextMenu.contains(activeEl)) {
      activeEl.blur()
    }
    this.contextMenu.classList.remove("is-open")
    this.contextMenu.style.display = "none"
    this.contextMenu.setAttribute("aria-hidden", "true")
  }
  
  handleContextMenuClick(e) {
    const actionButton = e.target.closest("[data-action]")
    if (!actionButton || actionButton.disabled) return
    const action = actionButton.dataset.action
    const actionMap = {
      togglePlay: () => this.togglePlay(),
      toggleMute: () => this.toggleMute(),
      changeSpeed: () => this.changePlaybackSpeed(),
      toggleCaptions: () => this.toggleCaptions(),
      toggleTheater: () => this.toggleTheaterMode(),
      toggleFullScreen: () => this.toggleFullScreenMode(),
      toggleMiniPlayer: () => this.toggleMiniPlayerMode(),
      showAbout: () => this.openAboutModal(),
    }
    const handler = actionMap[action]
    if (handler) {
      handler()
    }
    this.hideContextMenu()
  }
  
  handleDocumentClick(e) {
    if (!this.isContextMenuOpen) return
    if (this.contextMenu.contains(e.target)) return
    if (this.container.contains(e.target)) return
    this.hideContextMenu()
  }
  
  handleContextMenuKeyboard() {
    this.contextMenu.dataset.inputMethod = "keyboard"
    const activeEl = document.activeElement
    if (!this.contextMenu.contains(activeEl)) {
      const firstEnabledItem = this.contextMenuItems.find(item => !item.disabled)
      firstEnabledItem?.focus({ preventScroll: true })
    }
  }
  
  handleGlobalKeydown(e) {
    if (this.isAboutModalOpen && this.aboutDialog.contains(document.activeElement)) {
      if (e.key === "Escape") {
        e.preventDefault()
        this.closeAboutModal()
        return
      }
      if (e.key === "Tab") {
        this.trapFocusInAboutModal(e)
      }
      return
    }
    if (!this.isContextMenuOpen) return
    if (!this.contextMenu.contains(document.activeElement)) return
    if (e.key === "Escape") {
      e.preventDefault()
      this.hideContextMenu()
      this.video.focus({ preventScroll: true })
    }
  }
  
  updateContextMenuLabels() {
    const playbackLabel = rate =>
      Number.isInteger(rate)
        ? `${rate.toFixed(0)}×`
        : `${rate.toFixed(2).replace(/\.0+$/, "").replace(/(\.[1-9])0$/, "$1")}×`
    this.contextMenuItems.forEach(item => {
      const label = item.querySelector(".menu-label")
      if (!label) return
      switch (item.dataset.action) {
        case "togglePlay":
          label.textContent = this.video.paused ? "Play" : "Pause"
          break
        case "toggleMute":
          label.textContent = this.video.muted || this.video.volume === 0 ? "Unmute" : "Mute"
          break
        case "changeSpeed":
          label.textContent = `Playback Speed ${playbackLabel(this.video.playbackRate)}`
          break
        case "toggleCaptions":
          if (!this.captions) {
            item.disabled = true
            label.textContent = "Captions Unavailable"
          } else {
            item.disabled = false
            const isShowing = this.captions.mode === "showing"
            label.textContent = isShowing ? "Turn Off Captions" : "Turn On Captions"
          }
          break
        case "toggleTheater":
          label.textContent = this.container.classList.contains("theater")
            ? "Exit Theater Mode"
            : "Enter Theater Mode"
          break
        case "toggleFullScreen":
          label.textContent = document.fullscreenElement === this.container
            ? "Exit Full Screen"
            : "Enter Full Screen"
          break
        case "toggleMiniPlayer": {
          const pipSupported = "pictureInPictureEnabled" in document
          if (!pipSupported) {
            item.disabled = true
            label.textContent = "Picture-in-Picture Unavailable"
          } else {
            item.disabled = false
            const isInPip = document.pictureInPictureElement === this.video
            label.textContent = isInPip
              ? "Exit Picture-in-Picture"
              : "Enter Picture-in-Picture"
          }
          break
        }
        case "showAbout":
          item.disabled = false
          label.textContent = `About ${PLAYER_NAME}`
          break
        default:
          break
      }
    })
  }
  
  // Modal methods
  createAboutModal() {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'

    // Create modal dialog
    const modal = document.createElement('div')
    modal.className = 'about-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', 'about-modal-title')
    modal.setAttribute('aria-hidden', 'true')
    modal.tabIndex = -1

    // Close button
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'about-close-btn'
    closeBtn.setAttribute('aria-label', 'Close dialog')
    closeBtn.innerHTML = '&times;'
    modal.appendChild(closeBtn)

    // Header
    const header = document.createElement('div')
    header.className = 'about-modal-header'

    const titleBlock = document.createElement('div')
    titleBlock.className = 'about-modal-title-block'

    const eyebrow = document.createElement('p')
    eyebrow.className = 'about-modal-eyebrow'
    eyebrow.textContent = PLAYER_NAME

    const title = document.createElement('h2')
    title.id = 'about-modal-title'
    title.textContent = 'About'

    titleBlock.append(eyebrow, title)

    const version = document.createElement('span')
    version.className = 'about-modal-version'
    version.setAttribute('aria-label', `Version ${PLAYER_VERSION}`)
    version.textContent = `v${PLAYER_VERSION}`

    header.append(titleBlock, version)
    modal.appendChild(header)

    // Description paragraph
    const desc = document.createElement('p')
    desc.className = 'about-modal-description'
    modal.appendChild(desc)

    // Technical details section
    const tech = document.createElement('div')
    tech.className = 'about-tech'

    const techToggle = document.createElement('button')
    techToggle.type = 'button'
    techToggle.className = 'tech-toggle'
    techToggle.setAttribute('aria-expanded', 'false')
    techToggle.setAttribute('aria-controls', 'about-tech-panel')

    const techLabel = document.createElement('span')
    techLabel.className = 'tech-toggle-label'
    techLabel.textContent = 'Technical Details'

    const techIcon = document.createElement('span')
    techIcon.className = 'tech-toggle-icon'
    techIcon.setAttribute('aria-hidden', 'true')
    techIcon.textContent = '▾'

    techToggle.append(techLabel, techIcon)

    const techPanel = document.createElement('div')
    techPanel.className = 'tech-panel'
    techPanel.id = 'about-tech-panel'
    techPanel.hidden = true

    const techStatus = document.createElement('div')
    techStatus.className = 'tech-status'
    techStatus.hidden = true

    const metaList = document.createElement('dl')
    metaList.className = 'about-meta-list'

    techPanel.append(techStatus, metaList)
    tech.append(techToggle, techPanel)

    modal.appendChild(tech)

    // Assemble and append
    overlay.appendChild(modal)
    overlay._playerInstance = this
    document.body.appendChild(overlay)

    return {
      overlay,
      dialog: modal,
      closeButton: closeBtn,
      metaList: metaList,
      description: desc,
      techToggle: techToggle,
      techPanel: techPanel,
      techStatus: techStatus,
    }
  }
  
  openAboutModal() {
    if (this.isAboutModalOpen) return
    
    // Close any other open modals
    document.querySelectorAll(".modal-overlay.is-open").forEach(overlay => {
      if (overlay !== this.aboutOverlay && overlay._playerInstance) {
        overlay._playerInstance.closeAboutModal()
      }
    })
    
    this.lastFocusBeforeModal = document.activeElement
    const videoTitle = this.video.getAttribute("data-video-title") || document.title
    const pageTitle = videoTitle ? `"${videoTitle}"` : "this session"
    this.aboutDescription.textContent =
      `You are watching ${pageTitle} using ${PLAYER_NAME} v${PLAYER_VERSION}, our custom HTML5 experience featuring keyboard shortcuts, theater view, picture-in-picture, and fine-grained controls.`
    this.setTechPanelExpanded(false)
    this.updateAboutModalContent()
    this.aboutOverlay.classList.add("is-open")
    document.body.classList.add("modal-open")
    this.isAboutModalOpen = true
    this.ensureTechMetadata({ showStatus: false })
    requestAnimationFrame(() => {
      this.aboutDialog.removeAttribute("aria-hidden")
      this.aboutCloseButton.focus({ preventScroll: true })
    })
  }
  
  closeAboutModal() {
    if (!this.isAboutModalOpen) return
    this.isAboutModalOpen = false
    this.aboutOverlay.classList.remove("is-open")
    this.aboutDialog.setAttribute("aria-hidden", "true")
    document.body.classList.remove("modal-open")
    this.setTechPanelExpanded(false)
    this.setTechStatus("", false)
    const focusTarget =
      this.lastFocusBeforeModal && typeof this.lastFocusBeforeModal.focus === "function"
        ? this.lastFocusBeforeModal
        : this.video
    this.lastFocusBeforeModal = null
    requestAnimationFrame(() => {
      focusTarget.focus({ preventScroll: true })
    })
  }
  
  handleOverlayClick(e) {
    if (e.target === this.aboutOverlay) {
      this.closeAboutModal()
    }
  }
  
  keepFocusInsideModal(e) {
    if (!this.isAboutModalOpen) return
    if (!this.aboutDialog.contains(e.target)) {
      if (this.aboutOverlay.contains(e.target)) {
        this.aboutCloseButton.focus({ preventScroll: true })
      }
    }
  }
  
  trapFocusInAboutModal(e) {
    const focusable = Array.from(
      this.aboutDialog.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)
    ).filter(el => !el.hasAttribute("disabled") && el.tabIndex !== -1)
    if (focusable.length === 0) {
      e.preventDefault()
      this.aboutCloseButton.focus({ preventScroll: true })
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus({ preventScroll: true })
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus({ preventScroll: true })
    }
  }
  
  toggleTechPanel() {
    this.setTechPanelExpanded(!this.isTechPanelExpanded())
  }
  
  setTechPanelExpanded(expanded) {
    if (!this.aboutTechToggle || !this.aboutTechPanel) return
    this.aboutTechToggle.setAttribute("aria-expanded", String(expanded))
    this.aboutTechToggle.classList.toggle("is-expanded", expanded)
    this.aboutTechPanel.hidden = !expanded
    if (expanded) {
      this.ensureTechMetadata({ showStatus: true })
    }
    this.updateTechStatusVisibility()
  }
  
  isTechPanelExpanded() {
    return this.aboutTechToggle?.getAttribute("aria-expanded") === "true"
  }
  
  async ensureTechMetadata({ showStatus = true } = {}) {
    const resolvedSrc = this.getResolvedVideoSrc()
    if (!resolvedSrc) return
    const cachedMeta = sourceMetaCache.get(resolvedSrc)
    if (cachedMeta && !cachedMeta.error) return
    if (pendingSourceMeta.has(resolvedSrc)) {
      if (showStatus && this.isTechPanelExpanded()) {
        this.setTechStatus("Fetching video metadata…", false)
      }
      return
    }
    if (showStatus && this.isTechPanelExpanded()) {
      this.setTechStatus("Fetching video metadata…", false)
    }
    try {
      const meta = await this.ensureVideoSourceMeta(resolvedSrc)
      if (meta?.error) {
        this.setTechStatus("Unable to retrieve video metadata.", true)
      } else {
        this.setTechStatus("", false)
      }
    } catch (error) {
      this.setTechStatus("Unable to retrieve video metadata.", true)
    } finally {
      this.updateAboutModalContent()
    }
  }
  
  setTechStatus(message, isError = false) {
    this.techStatusMessage = message
    this.techStatusIsError = isError
    this.updateTechStatusVisibility()
  }
  
  updateTechStatusVisibility() {
    if (!this.aboutTechStatus) return
    const shouldShow = Boolean(this.techStatusMessage) && this.isTechPanelExpanded()
    this.aboutTechStatus.textContent = this.techStatusMessage
    this.aboutTechStatus.hidden = !shouldShow
    this.aboutTechStatus.classList.toggle("is-error", this.techStatusIsError)
  }
  
  updateAboutModalContent() {
    if (!this.aboutMetaList) return
    const resolvedSrc = this.getResolvedVideoSrc()
    const videoSrc = this.video.currentSrc || this.video.src
    const fileLabel = this.deriveVideoSourceLabel(videoSrc)
    const durationLabel = this.formatVideoDuration(this.video.duration)
    const positionLabel = this.formatVideoDuration(this.video.currentTime)
    const resolutionLabel =
      this.video.videoWidth && this.video.videoHeight
        ? `${this.video.videoWidth} × ${this.video.videoHeight}`
        : "Pending"
    const playbackRateLabel = this.formatPlaybackRate(this.video.playbackRate)
    const volumeLabel = `${Math.round(this.video.volume * 100)}%${
      this.video.muted ? " (Muted)" : ""
    }`
    let captionsLabel = "Unavailable"
    if (this.captions) {
      const baseLabel = this.captions.label || this.captions.language || "Track 1"
      captionsLabel =
        this.captions.mode === "showing"
          ? baseLabel ? `On (${baseLabel})` : "On"
          : baseLabel ? `Off (${baseLabel})` : "Off"
    }
    const playbackModeLabel = this.getPlaybackModeLabel()
    const sourceMeta = resolvedSrc ? sourceMetaCache.get(resolvedSrc) : undefined
    const fileSizeLabel = (() => {
      if (!sourceMeta) return pendingSourceMeta.has(resolvedSrc) ? "Fetching…" : "Unknown"
      if (sourceMeta.error) return "Unavailable"
      if (Number.isFinite(sourceMeta.fileSize)) {
        return this.formatFileSize(sourceMeta.fileSize)
      }
      return "Unknown"
    })()
    const bitrateLabel = (() => {
      if (!sourceMeta) {
        return pendingSourceMeta.has(resolvedSrc) ? "Calculating…" : "Unknown"
      }
      if (sourceMeta.error) return "Unavailable"
      if (Number.isFinite(sourceMeta.fileSize) && this.video.duration > 0) {
        const bitsPerSecond = (sourceMeta.fileSize * 8) / this.video.duration
        return this.formatBitrate(bitsPerSecond)
      }
      return "Unknown"
    })()
    const mimeLabel = sourceMeta?.contentType || this.deriveMimeFromSrc(videoSrc) || "Unknown"
    let statusMessage = ""
    let statusIsError = false
    if (pendingSourceMeta.has(resolvedSrc)) {
      statusMessage = "Fetching video metadata…"
    } else if (sourceMeta?.error) {
      statusMessage = "Unable to retrieve video metadata."
      statusIsError = true
    }
    this.setTechStatus(statusMessage, statusIsError)
    const metadataEntries = [
      { label: "Video Source", value: fileLabel },
      { label: "MIME Type", value: mimeLabel },
      { label: "File Size", value: fileSizeLabel },
      { label: "Average Bitrate", value: bitrateLabel },
      { label: "Duration", value: durationLabel },
      { label: "Current Position", value: positionLabel },
      { label: "Resolution", value: resolutionLabel },
      { label: "Playback Speed", value: playbackRateLabel },
      { label: "Volume", value: volumeLabel },
      { label: "Captions", value: captionsLabel },
      { label: "Playback Mode", value: playbackModeLabel },
    ]
    this.aboutMetaList.textContent = ""
    metadataEntries.forEach(({ label, value }) => {
      const term = document.createElement("dt")
      term.className = "about-meta-term"
      term.textContent = label
      const desc = document.createElement("dd")
      desc.className = "about-meta-value"
      desc.textContent = value
      this.aboutMetaList.append(term, desc)
    })
  }
  
  // Utility methods
  getResolvedVideoSrc() {
    const rawSrc = this.video.currentSrc || this.video.src
    if (!rawSrc) return ""
    try {
      return new URL(rawSrc, window.location.href).href
    } catch (error) {
      return rawSrc
    }
  }
  
  async ensureVideoSourceMeta(resolvedSrc) {
    if (sourceMetaCache.has(resolvedSrc)) {
      const cached = sourceMetaCache.get(resolvedSrc)
      if (!cached || cached.error) {
        sourceMetaCache.delete(resolvedSrc)
      } else {
        return cached
      }
    }
    if (pendingSourceMeta.has(resolvedSrc)) {
      return pendingSourceMeta.get(resolvedSrc)
    }
    const request = (async () => {
      try {
        const response = await fetch(resolvedSrc, { method: "HEAD" })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const contentLengthHeader = response.headers.get("content-length")
        const parsedSize = contentLengthHeader ? Number(contentLengthHeader) : NaN
        const fileSize = Number.isFinite(parsedSize) ? parsedSize : null
        const contentType = response.headers.get("content-type") || ""
        const meta = { fileSize, contentType }
        sourceMetaCache.set(resolvedSrc, meta)
        return meta
      } catch (error) {
        const meta = { error: error instanceof Error ? error.message : "Metadata request failed" }
        sourceMetaCache.set(resolvedSrc, meta)
        return meta
      } finally {
        pendingSourceMeta.delete(resolvedSrc)
      }
    })()
    pendingSourceMeta.set(resolvedSrc, request)
    return request
  }
  
  formatDuration(time) {
    if (!Number.isFinite(time) || time < 0) return "0:00"
    const seconds = Math.floor(time % 60)
    const minutes = Math.floor(time / 60) % 60
    const hours = Math.floor(time / 3600)
    if (hours === 0) {
      return `${minutes}:${leadingZeroFormatter.format(seconds)}`
    }
    return `${hours}:${leadingZeroFormatter.format(minutes)}:${leadingZeroFormatter.format(seconds)}`
  }
  
  formatVideoDuration(time) {
    if (!Number.isFinite(time) || time < 0) return "Loading..."
    return this.formatDuration(time)
  }
  
  deriveMimeFromSrc(src) {
    if (!src) return ""
    const cleanSrc = src.split("?")[0].split("#")[0]
    const parts = cleanSrc.split(".")
    if (parts.length < 2) return ""
    const extension = parts.pop().toLowerCase()
    const knownTypes = {
      mp4: "video/mp4",
      webm: "video/webm",
      ogv: "video/ogg",
      mov: "video/quicktime",
      m3u8: "application/x-mpegURL",
    }
    return knownTypes[extension] || `video/${extension}`
  }
  
  deriveVideoSourceLabel(src) {
    if (!src) return "Unavailable"
    try {
      const url = new URL(src, window.location.href)
      const segments = url.pathname.split("/").filter(Boolean)
      if (segments.length) return decodeURIComponent(segments[segments.length - 1])
      return url.hostname
    } catch (error) {
      const segments = src.split("/")
      return decodeURIComponent(segments[segments.length - 1] || src)
    }
  }
  
  formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown"
    const units = ["B", "KB", "MB", "GB", "TB"]
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex += 1
    }
    const decimals = size < 10 && unitIndex > 0 ? 2 : 1
    return `${parseFloat(size.toFixed(decimals))} ${units[unitIndex]}`
  }
  
  formatBitrate(bitsPerSecond) {
    if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "Unknown"
    const units = ["bps", "Kbps", "Mbps", "Gbps"]
    let rate = bitsPerSecond
    let unitIndex = 0
    while (rate >= 1000 && unitIndex < units.length - 1) {
      rate /= 1000
      unitIndex += 1
    }
    const decimals = rate < 10 && unitIndex > 0 ? 2 : 1
    return `${parseFloat(rate.toFixed(decimals))} ${units[unitIndex]}`
  }
  
  getPlaybackModeLabel() {
    if (document.pictureInPictureElement === this.video) return "Picture-in-Picture"
    if (document.fullscreenElement === this.container) return "Full Screen"
    if (this.container.classList.contains("theater")) return "Theater"
    return "Standard"
  }
  
  formatPlaybackRate(rate) {
    if (!Number.isFinite(rate)) return "1×"
    const formatted =
      rate % 1 === 0
        ? rate.toFixed(0)
        : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    return `${formatted}×`
  }
  
  // Public API for cleanup
  destroy() {
    // Remove context menu and modal from DOM
    if (this.contextMenu && this.contextMenu.parentNode) {
      this.contextMenu.parentNode.removeChild(this.contextMenu)
    }
    if (this.aboutOverlay && this.aboutOverlay.parentNode) {
      this.aboutOverlay.parentNode.removeChild(this.aboutOverlay)
    }
  }
}

// Auto-initialize all video players on the page
document.addEventListener("DOMContentLoaded", () => {
  const containers = document.querySelectorAll(".video-container")
  containers.forEach(container => {
    new VideoPlayer(container)
  })
})
