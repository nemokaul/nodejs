/**
 * JavaScript & Node.js E2 Mastery Course Tracker Engine
 * Handles LinkedIn Learning style 3-state checkbox tracking,
 * count & duration aggregation, backup/restore, and interactive UI updates.
 */

(function () {
  const STORAGE_KEY = "nodejs_course_tracker_v1";

  // State structure
  let state = {
    version: 1,
    progress: {}, // [videoKey]: { status: 'not_started' | 'in_progress' | 'completed', updatedAt: number }
    activeVideoKey: null
  };

  // Helper: Format seconds into readable string (e.g. 2h 15m or 45m 12s)
  function formatSeconds(sec) {
    if (!sec || isNaN(sec)) return "0m";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (m > 0) {
      return `${m}m`;
    }
    return `${s}s`;
  }

  // Helper: Format seconds into padded 00m00s / HHhMMmSSs string
  function formatMMSS(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return "00m00s";
    const totalSec = Math.round(sec);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
    }
    return `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
  }

  // Helper: Escape HTML strings to prevent XSS and rendering breakages
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Get aggregated stats for a specific chapter
  function getChapterStats(chapId) {
    const courseData = window.COURSE_DATA;
    if (!courseData || !courseData.sections) {
      return {
        totalVideos: 0,
        completedVideos: 0,
        inProgressVideos: 0,
        totalDuration: 0,
        completedDuration: 0,
        inProgressDuration: 0,
        pctCount: 0,
        pctDuration: 0
      };
    }

    let totalVideos = 0;
    let completedVideos = 0;
    let inProgressVideos = 0;
    let totalDuration = 0;
    let completedDuration = 0;
    let inProgressDuration = 0;

    for (const sec of courseData.sections) {
      const ch = sec.chapters.find(c => c.id === chapId || c.number === chapId || String(c.id) === String(chapId));
      if (ch) {
        for (const v of ch.videos) {
          totalVideos++;
          totalDuration += v.durationSeconds || 0;
          const status = getVideoStatus(v.id);
          if (status === "completed") {
            completedVideos++;
            completedDuration += v.durationSeconds || 0;
          } else if (status === "in_progress") {
            inProgressVideos++;
            inProgressDuration += v.durationSeconds || 0;
          }
        }
        break;
      }
    }

    const pctCount = totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0;
    const pctDuration = totalDuration > 0 ? Math.round((completedDuration / totalDuration) * 100) : 0;

    return {
      totalVideos,
      completedVideos,
      inProgressVideos,
      totalDuration,
      completedDuration,
      inProgressDuration,
      pctCount,
      pctDuration
    };
  }

  // Get aggregated stats for a specific Part (1, 2, or 3)
  function getPartStats(partNum) {
    const courseData = window.COURSE_DATA;
    if (!courseData || !courseData.sections) {
      return { totalVideos: 0, completedVideos: 0, totalDuration: 0, completedDuration: 0, pctCount: 0 };
    }
    let totalVideos = 0;
    let completedVideos = 0;
    let totalDuration = 0;
    let completedDuration = 0;

    const sectionsInPart = courseData.sections.filter(s => s.part === Number(partNum));
    for (const sec of sectionsInPart) {
      for (const ch of sec.chapters) {
        for (const v of ch.videos) {
          totalVideos++;
          totalDuration += v.durationSeconds || 0;
          const status = getVideoStatus(v.id);
          if (status === "completed") {
            completedVideos++;
            completedDuration += v.durationSeconds || 0;
          }
        }
      }
    }
    const pctCount = totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0;
    return { totalVideos, completedVideos, totalDuration, completedDuration, pctCount };
  }

  let currentHighlightedEl = null;
  let dismissHighlightListener = null;

  function clearSidebarHighlight() {
    if (dismissHighlightListener) {
      document.removeEventListener("pointerdown", dismissHighlightListener, true);
      document.removeEventListener("keydown", dismissHighlightListener, true);
      dismissHighlightListener = null;
    }
    document.querySelectorAll(".sidebar-highlight-active, .sidebar-highlight-ring, .sidebar-highlight-subtle, .glow-highlight").forEach(el => {
      el.classList.remove("sidebar-highlight-active", "sidebar-highlight-ring", "sidebar-highlight-subtle", "glow-highlight");
    });
    currentHighlightedEl = null;
  }

  function applySidebarHighlight(targetEl) {
    if (!targetEl) return;

    // Clear any previous highlight
    clearSidebarHighlight();

    currentHighlightedEl = targetEl;

    // Force DOM reflow to cleanly restart the blink keyframe
    void targetEl.offsetWidth;

    // 1. Begin blink pulse and prominent glowing ring
    targetEl.classList.add("sidebar-highlight-active", "sidebar-highlight-ring");

    // After the blink animation completes (~1350ms), remove active blink class
    // but KEEP .sidebar-highlight-ring so the glowing ring holds indefinitely until user interacts!
    const blinkTimer = setTimeout(() => {
      targetEl.classList.remove("sidebar-highlight-active");
    }, 1350);

    // 2. Attach user interaction listener to transition to subtle persistent highlight
    // Grace period of 350ms ensures the click that opened the navigation doesn't instantly dismiss it
    setTimeout(() => {
      if (currentHighlightedEl !== targetEl) return;

      dismissHighlightListener = (e) => {
        // Clicks inside sidebar shouldn't dismiss the on-page ring
        if (e.target && e.target.closest("#course-sidebar")) {
          return;
        }

        clearTimeout(blinkTimer);
        targetEl.classList.remove("sidebar-highlight-active", "sidebar-highlight-ring");
        // Keep slight highlighted even after user interacts!
        targetEl.classList.add("sidebar-highlight-subtle");

        document.removeEventListener("pointerdown", dismissHighlightListener, true);
        document.removeEventListener("keydown", dismissHighlightListener, true);
        dismissHighlightListener = null;
      };

      document.addEventListener("pointerdown", dismissHighlightListener, true);
      document.addEventListener("keydown", dismissHighlightListener, true);
    }, 350);
  }

  // Handle sidebar navigation: auto-open details, blink + ring highlight, scroll, and active indicator
  function handleSidebarNavigation(targetId) {
    if (!targetId) return;
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;

    // 1. If target is inside collapsed details (e.g. chapter card), expand them
    let parent = targetEl.parentElement;
    while (parent) {
      if (parent.tagName === "DETAILS" && !parent.open) {
        parent.open = true;
      }
      parent = parent.parentElement;
    }

    // 2. Smoothly scroll into center
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

    // 3. Apply blink, indefinite ring, and subtle highlight on interaction
    applySidebarHighlight(targetEl);

    // 4. Update active states in sidebar
    if (targetId.startsWith("flashcards-")) {
      const cleanFcId = targetId.replace("flashcards-", "");
      updateActiveSidebarFlashcard(cleanFcId);
    } else if (targetId.startsWith("summary-btn-")) {
      const cleanSumId = targetId.replace("summary-btn-", "");
      updateActiveSidebarSummary(cleanSumId);
    } else {
      const cleanId = targetId.startsWith("video-") ? targetId.replace("video-", "") : targetId;
      updateActiveSidebarItem(cleanId);
    }
  }

  // Update active sidebar flashcard link
  function updateActiveSidebarFlashcard(deckId) {
    if (!deckId) return;
    document.querySelectorAll(".sidebar-video-link, .sidebar-flashcard-link, .sidebar-summary-link").forEach(link => {
      link.classList.remove("active-sidebar-item");
    });
    document.querySelectorAll(".chapter-summary").forEach(sum => {
      sum.classList.remove("active-chapter-header");
    });

    const activeFc = document.querySelector(`.sidebar-flashcard-link[data-sidebar-fc-deck="${deckId}"]`);
    if (activeFc) {
      activeFc.classList.add("active-sidebar-item");

      // Highlight and expand parent chapter details if nested
      const parentChap = activeFc.closest(".chapter-details");
      if (parentChap) {
        if (!parentChap.open) parentChap.open = true;
        const sum = parentChap.querySelector(".chapter-summary");
        if (sum) sum.classList.add("active-chapter-header");
      }

      // Ensure parent section details is open
      const parentSec = activeFc.closest("aside#course-sidebar details");
      if (parentSec && !parentSec.open) {
        parentSec.open = true;
      }

      // Scroll sidebar container to keep active item in view if needed
      const sidebarNav = document.getElementById("sidebar-nav-container");
      if (sidebarNav) {
        const linkRect = activeFc.getBoundingClientRect();
        const navRect = sidebarNav.getBoundingClientRect();
        if (linkRect.top < navRect.top || linkRect.bottom > navRect.bottom) {
          activeFc.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }
  }

  // Update active sidebar summary link
  function updateActiveSidebarSummary(sumId) {
    if (!sumId) return;
    document.querySelectorAll(".sidebar-video-link, .sidebar-flashcard-link, .sidebar-summary-link").forEach(link => {
      link.classList.remove("active-sidebar-item");
    });
    document.querySelectorAll(".chapter-summary").forEach(sum => {
      sum.classList.remove("active-chapter-header");
    });

    const activeSum = document.querySelector(`.sidebar-summary-link[data-sidebar-summary-id="${sumId}"]`);
    if (activeSum) {
      activeSum.classList.add("active-sidebar-item");

      // Highlight and expand parent chapter details if nested
      const parentChap = activeSum.closest(".chapter-details");
      if (parentChap) {
        if (!parentChap.open) parentChap.open = true;
        const sum = parentChap.querySelector(".chapter-summary");
        if (sum) sum.classList.add("active-chapter-header");
      }

      // Ensure parent section details is open
      const parentSec = activeSum.closest("aside#course-sidebar details");
      if (parentSec && !parentSec.open) {
        parentSec.open = true;
      }

      // Scroll sidebar container to keep active item in view if needed
      const sidebarNav = document.getElementById("sidebar-nav-container");
      if (sidebarNav) {
        const linkRect = activeSum.getBoundingClientRect();
        const navRect = sidebarNav.getBoundingClientRect();
        if (linkRect.top < navRect.top || linkRect.bottom > navRect.bottom) {
          activeSum.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }
  }

  // Update active sidebar link, chapter header, and parent details
  function updateActiveSidebarItem(cleanVideoId) {
    if (!cleanVideoId) return;

    // Remove active styles from links and chapter headers
    document.querySelectorAll(".sidebar-video-link, .sidebar-flashcard-link, .sidebar-summary-link").forEach(link => {
      link.classList.remove("active-sidebar-item");
    });
    document.querySelectorAll(".chapter-summary").forEach(sum => {
      sum.classList.remove("active-chapter-header");
    });

    const activeLink = document.querySelector(`.sidebar-video-link[data-sidebar-video-id="${cleanVideoId}"]`);
    if (activeLink) {
      activeLink.classList.add("active-sidebar-item");

      // Highlight and expand parent chapter details
      const parentChap = activeLink.closest(".chapter-details");
      if (parentChap) {
        if (!parentChap.open) parentChap.open = true;
        const sum = parentChap.querySelector(".chapter-summary");
        if (sum) sum.classList.add("active-chapter-header");
      }

      // Ensure parent section details is open
      const parentSec = activeLink.closest("aside#course-sidebar details");
      if (parentSec && !parentSec.open) {
        parentSec.open = true;
      }

      // Scroll sidebar container to keep active item in view if needed
      const sidebarNav = document.getElementById("sidebar-nav-container");
      if (sidebarNav) {
        const linkRect = activeLink.getBoundingClientRect();
        const navRect = sidebarNav.getBoundingClientRect();
        if (linkRect.top < navRect.top || linkRect.bottom > navRect.bottom) {
          activeLink.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }
  }

  // Load from localStorage
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.progress) {
          state = { ...state, ...parsed };
        }
      }
    } catch (e) {
      console.warn("Could not load course progress from localStorage", e);
    }
  }

  // Save to localStorage
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Could not save course progress to localStorage", e);
    }
  }

  // Get status for a video key
  function getVideoStatus(key) {
    if (!state.progress[key]) return "not_started";
    return state.progress[key].status || "not_started";
  }

  // Set status for a video key
  function setVideoStatus(key, newStatus) {
    if (!state.progress[key]) {
      state.progress[key] = { status: newStatus, updatedAt: Date.now() };
    } else {
      state.progress[key].status = newStatus;
      state.progress[key].updatedAt = Date.now();
    }
    if (newStatus === "in_progress") {
      state.activeVideoKey = key;
    } else if (state.activeVideoKey === key && newStatus !== "in_progress") {
      state.activeVideoKey = null;
    }
    saveState();
    syncUI();
    window.dispatchEvent(new CustomEvent("course-tracker-updated", { detail: { key, status: newStatus } }));
  }

  // Toggle status cycle: not_started -> in_progress -> completed -> not_started
  function cycleVideoStatus(key) {
    const current = getVideoStatus(key);
    let next = "not_started";
    if (current === "not_started") next = "in_progress";
    else if (current === "in_progress") next = "completed";
    else if (current === "completed") next = "not_started";
    setVideoStatus(key, next);
  }

  // Calculate statistics across all sections or a single section
  function getStats(targetSectionId) {
    const courseData = window.COURSE_DATA;
    if (!courseData || !courseData.sections) {
      return {
        totalVideos: 0,
        completedVideos: 0,
        inProgressVideos: 0,
        totalDuration: 0,
        completedDuration: 0,
        inProgressDuration: 0,
        pctCount: 0,
        pctDuration: 0
      };
    }

    let totalVideos = 0;
    let completedVideos = 0;
    let inProgressVideos = 0;
    let totalDuration = 0;
    let completedDuration = 0;
    let inProgressDuration = 0;

    const sectionsToCount = targetSectionId
      ? courseData.sections.filter(s => s.id === targetSectionId || s.slug === targetSectionId)
      : courseData.sections;

    for (const sec of sectionsToCount) {
      for (const ch of sec.chapters) {
        for (const v of ch.videos) {
          totalVideos++;
          totalDuration += v.durationSeconds || 0;
          const status = getVideoStatus(v.id);
          if (status === "completed") {
            completedVideos++;
            completedDuration += v.durationSeconds || 0;
          } else if (status === "in_progress") {
            inProgressVideos++;
            inProgressDuration += v.durationSeconds || 0;
          }
        }
      }
    }

    const pctCount = totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0;
    const pctDuration = totalDuration > 0 ? Math.round((completedDuration / totalDuration) * 100) : 0;

    return {
      totalVideos,
      completedVideos,
      inProgressVideos,
      totalDuration,
      completedDuration,
      inProgressDuration,
      pctCount,
      pctDuration
    };
  }

  // Sync all DOM elements
  function syncUI() {
    const globalStats = getStats();

    // 1. Update Global Header Stats
    const elGlobalVidCount = document.getElementById("global-video-count");
    if (elGlobalVidCount) elGlobalVidCount.textContent = `${globalStats.completedVideos}/${globalStats.totalVideos}`;

    const elGlobalTime = document.getElementById("global-time-count");
    if (elGlobalTime) {
      elGlobalTime.textContent = `${formatSeconds(globalStats.completedDuration)} / ${formatSeconds(globalStats.totalDuration)}`;
    }

    const elGlobalInProgTime = document.getElementById("global-inprogress-time");
    if (elGlobalInProgTime) {
      if (globalStats.inProgressVideos > 0) {
        elGlobalInProgTime.textContent = `${formatSeconds(globalStats.inProgressDuration)} in progress`;
        elGlobalInProgTime.classList.remove("hidden");
      } else {
        elGlobalInProgTime.classList.add("hidden");
      }
    }

    const elGlobalBar = document.getElementById("global-progress-bar");
    if (elGlobalBar) elGlobalBar.style.width = `${globalStats.pctDuration}%`;

    const elGlobalPct = document.getElementById("global-progress-pct");
    if (elGlobalPct) elGlobalPct.textContent = `${globalStats.pctDuration}%`;

    // 1b. Update Mobile Sidebar Progress Card (when present)
    const elSidebarVidCount = document.querySelector("[data-sidebar-video-count]");
    if (elSidebarVidCount) elSidebarVidCount.textContent = `${globalStats.completedVideos}/${globalStats.totalVideos} videos`;

    const elSidebarTimeCount = document.querySelector("[data-sidebar-time-count]");
    if (elSidebarTimeCount) {
      elSidebarTimeCount.textContent = `${formatSeconds(globalStats.completedDuration)} / ${formatSeconds(globalStats.totalDuration)}`;
    }

    const elSidebarBar = document.querySelector("[data-sidebar-progress-bar]");
    if (elSidebarBar) elSidebarBar.style.width = `${globalStats.pctDuration}%`;

    const elSidebarPct = document.querySelector("[data-sidebar-progress-pct]");
    if (elSidebarPct) elSidebarPct.textContent = `${globalStats.pctDuration}%`;

    const elSidebarInProgCont = document.querySelector("[data-sidebar-inprogress-container]");
    const elSidebarInProgTime = document.querySelector("[data-sidebar-inprogress-time]");
    if (elSidebarInProgCont && elSidebarInProgTime) {
      if (globalStats.inProgressVideos > 0) {
        elSidebarInProgTime.textContent = formatSeconds(globalStats.inProgressDuration);
        elSidebarInProgCont.classList.remove("hidden");
      } else {
        elSidebarInProgCont.classList.add("hidden");
      }
    }

    // 2. Update Dashboard Bento Grid Cards (if on homepage)
    const elDashCompVids = document.getElementById("dash-completed-videos");
    if (elDashCompVids) elDashCompVids.textContent = globalStats.completedVideos;

    const elDashInProgVids = document.getElementById("dash-inprogress-videos");
    if (elDashInProgVids) elDashInProgVids.textContent = globalStats.inProgressVideos;

    const elDashCompTime = document.getElementById("dash-completed-time");
    if (elDashCompTime) elDashCompTime.textContent = formatSeconds(globalStats.completedDuration);

    const elDashInProgTime = document.getElementById("dash-inprogress-time");
    if (elDashInProgTime) elDashInProgTime.textContent = formatSeconds(globalStats.inProgressDuration);

    const elDashPct = document.getElementById("dash-progress-pct");
    if (elDashPct) elDashPct.textContent = `${globalStats.pctDuration}%`;

    // 3. Update Checkboxes on Page & Sidebar
    document.querySelectorAll(".ll-checkbox[data-video-key]").forEach(cb => {
      const key = cb.getAttribute("data-video-key");
      const status = getVideoStatus(key);
      cb.setAttribute("data-state", status);
      cb.setAttribute("aria-label", `Video status: ${status.replace("_", " ")}`);

      // Update parent video card if present
      const card = cb.closest(".video-card");
      if (card) {
        card.setAttribute("data-card-state", status);
        const actionBtn = card.querySelector(".btn-mark-complete");
        if (actionBtn) {
          if (status === "completed") {
            actionBtn.innerHTML = `
              <svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Completed</span>
            `;
            actionBtn.className = "btn-mark-complete inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 transition-colors cursor-pointer";
          } else if (status === "in_progress") {
            actionBtn.innerHTML = `
              <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span>Mark as Complete</span>
            `;
            actionBtn.className = "btn-mark-complete inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors cursor-pointer";
          } else {
            actionBtn.innerHTML = `
              <svg class="w-3.5 h-3.5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Mark as Complete</span>
            `;
            actionBtn.className = "btn-mark-complete inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 transition-colors cursor-pointer";
          }
        }
      }
    });

    // 4. Update Per-Section Progress Badges on Sidebar and Pages
    document.querySelectorAll("[data-section-stats-id]").forEach(badge => {
      const secId = badge.getAttribute("data-section-stats-id");
      const secStats = getStats(secId);
      const mode = badge.getAttribute("data-stats-mode") || "both"; // 'count', 'time', or 'both'
      if (mode === "count") {
        badge.textContent = `${secStats.completedVideos}/${secStats.totalVideos}`;
      } else if (mode === "time") {
        badge.textContent = `${formatSeconds(secStats.completedDuration)} / ${formatSeconds(secStats.totalDuration)}`;
      } else {
        badge.textContent = `${secStats.completedVideos}/${secStats.totalVideos} videos • ${formatSeconds(secStats.completedDuration)}`;
      }
    });

    // Update Section Progress Bars
    document.querySelectorAll("[data-section-progress-bar]").forEach(bar => {
      const secId = bar.getAttribute("data-section-progress-bar");
      const secStats = getStats(secId);
      bar.style.width = `${secStats.pctDuration}%`;
    });

    // 5. Update Chapter Cumulative Time Badges (Sidebar & Main Cards)
    document.querySelectorAll("[data-chapter-time-id]").forEach(el => {
      const chId = el.getAttribute("data-chapter-time-id");
      const chStats = getChapterStats(chId);
      const isSidebar = el.closest("#course-sidebar") !== null;
      if (isSidebar) {
        el.textContent = `${formatMMSS(chStats.completedDuration)}/${formatMMSS(chStats.totalDuration)}`;
      } else {
        el.textContent = `${formatMMSS(chStats.completedDuration)} / ${formatMMSS(chStats.totalDuration)}`;
      }
    });

    // Update Chapter Lesson Count Badges (if present)
    document.querySelectorAll("[data-chapter-count-id]").forEach(el => {
      const chId = el.getAttribute("data-chapter-count-id");
      const chStats = getChapterStats(chId);
      el.textContent = `${chStats.completedVideos}/${chStats.totalVideos}`;
    });

    // 6. Update Section Total Time and Summary Badges
    document.querySelectorAll("[data-section-time-id]").forEach(el => {
      const secId = el.getAttribute("data-section-time-id");
      const secStats = getStats(secId);
      el.textContent = `${formatMMSS(secStats.completedDuration)} / ${formatMMSS(secStats.totalDuration)}`;
    });

    document.querySelectorAll("[data-section-time-summary-id]").forEach(el => {
      const secId = el.getAttribute("data-section-time-summary-id");
      const secStats = getStats(secId);
      el.textContent = `${formatMMSS(secStats.completedDuration)} / ${formatMMSS(secStats.totalDuration)}`;
    });

    // Update Section Percentage Displays
    document.querySelectorAll("[data-section-pct-id]").forEach(el => {
      const secId = el.getAttribute("data-section-pct-id");
      const secStats = getStats(secId);
      el.textContent = `${secStats.pctDuration}%`;
    });
    document.querySelectorAll("[data-section-pct-display-id]").forEach(el => {
      const secId = el.getAttribute("data-section-pct-display-id");
      const secStats = getStats(secId);
      el.textContent = `(${secStats.pctDuration}%)`;
    });

    // Update Section In-Progress Displays
    document.querySelectorAll("[data-section-inprogress-id]").forEach(el => {
      const secId = el.getAttribute("data-section-inprogress-id");
      const secStats = getStats(secId);
      el.textContent = formatMMSS(secStats.inProgressDuration);
      const cont = el.closest("[data-section-inprogress-container]");
      if (cont) {
        if (secStats.inProgressVideos > 0) {
          cont.classList.remove("hidden");
          cont.classList.add("inline-flex");
        } else {
          cont.classList.add("hidden");
          cont.classList.remove("inline-flex");
        }
      }
    });

    // 7. Update Part 1/2/3 Analytics on Homepage
    document.querySelectorAll("[data-part-stats-id]").forEach(el => {
      const partNum = el.getAttribute("data-part-stats-id");
      const partStats = getPartStats(partNum);
      el.textContent = `${partStats.completedVideos}/${partStats.totalVideos} Videos • ${formatSeconds(partStats.completedDuration)} / ${formatSeconds(partStats.totalDuration)}`;
    });
  }

  // Backup & Restore
  function exportProgressJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dlAnchor = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `nodejs-javascript-mastery-progress-${dateStr}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  function importProgressJSON(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed && typeof parsed.progress === "object") {
          state = { ...state, ...parsed };
          saveState();
          syncUI();
          alert("Progress successfully restored!");
          closeModal("backup-modal");
        } else {
          alert("Invalid backup file format.");
        }
      } catch (err) {
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function resetAllProgress() {
    if (confirm("Are you sure you want to reset all course progress? This action cannot be undone.")) {
      state.progress = {};
      state.activeVideoKey = null;
      saveState();
      syncUI();
      closeModal("backup-modal");
    }
  }

  // Theme Management
  function initTheme() {
    const savedTheme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains("dark");
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  }

  // Modal helpers
  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove("hidden");
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add("hidden");
  }

  // Initialize event listeners
  document.addEventListener("DOMContentLoaded", () => {
    loadState();
    initTheme();
    syncUI();

    // Restore desktop collapsible sidebar preference
    try {
      const isSidebarCollapsed = localStorage.getItem("sidebar-collapsed") === "true";
      if (isSidebarCollapsed) {
        document.body.classList.add("sidebar-collapsed");
      }
    } catch (e) {}

    // Checkbox click delegation
    document.addEventListener("click", e => {
      const cb = e.target.closest(".ll-checkbox[data-video-key]");
      if (cb) {
        e.preventDefault();
        e.stopPropagation();
        const key = cb.getAttribute("data-video-key");
        cycleVideoStatus(key);
        return;
      }

      // Mark as complete button
      const markBtn = e.target.closest(".btn-mark-complete");
      if (markBtn) {
        e.preventDefault();
        e.stopPropagation();
        const card = markBtn.closest(".video-card");
        if (card) {
          const key = card.getAttribute("data-video-key");
          const current = getVideoStatus(key);
          if (current === "completed") {
            setVideoStatus(key, "not_started");
          } else {
            setVideoStatus(key, "completed");
          }
        }
        return;
      }

      // Mark & Next button: complete current video and scroll to next video
      const markNextBtn = e.target.closest(".btn-mark-and-next");
      if (markNextBtn) {
        e.preventDefault();
        e.stopPropagation();
        const card = markNextBtn.closest(".video-card");
        if (card) {
          const key = card.getAttribute("data-video-key");
          setVideoStatus(key, "completed");

          // Find next card on page
          const allCards = Array.from(document.querySelectorAll(".video-card"));
          const currentIndex = allCards.indexOf(card);
          if (currentIndex >= 0 && currentIndex < allCards.length - 1) {
            const nextCard = allCards[currentIndex + 1];
            nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
            const nextKey = nextCard.getAttribute("data-video-key");
            if (getVideoStatus(nextKey) === "not_started") {
              setVideoStatus(nextKey, "in_progress");
            }
          }
        }
        return;
      }

      // Video link click: auto mark in-progress if not started
      const videoLink = e.target.closest("a[data-video-link]");
      if (videoLink) {
        const key = videoLink.getAttribute("data-video-key");
        if (getVideoStatus(key) === "not_started") {
          setVideoStatus(key, "in_progress");
        }
      }

      // Sidebar link click delegation (videos, flashcards & summary notes): smooth scroll, blink + ring highlight, and active state
      const sidebarNavTarget = e.target.closest(".sidebar-video-link, .sidebar-flashcard-link, .sidebar-summary-link");
      if (sidebarNavTarget) {
        const href = sidebarNavTarget.getAttribute("href");
        if (href && href.includes("#")) {
          const hashIndex = href.indexOf("#");
          const hashPart = href.substring(hashIndex);
          const targetId = hashPart.replace("#", "");
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            e.preventDefault();
            handleSidebarNavigation(targetId);
            try {
              history.pushState(null, "", hashPart);
            } catch (err) {}
            if (window.innerWidth < 1024) {
              const sidebar = document.getElementById("course-sidebar");
              const backdrop = document.getElementById("sidebar-backdrop");
              if (sidebar) sidebar.classList.add("-translate-x-full");
              if (backdrop) backdrop.classList.add("hidden");
            }
            return;
          }
        }
      }

      // Auto-close mobile sidebar when clicking internal sidebar navigation link
      const sidebarNavLink = e.target.closest("#course-sidebar a");
      if (sidebarNavLink && window.innerWidth < 1024) {
        const sidebar = document.getElementById("course-sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");
        if (sidebar) sidebar.classList.add("-translate-x-full");
        if (backdrop) backdrop.classList.add("hidden");
      }

      // Mark entire section complete
      const markSecCompleteBtn = e.target.closest("[data-action='complete-section']");
      if (markSecCompleteBtn) {
        const secId = markSecCompleteBtn.getAttribute("data-section-id");
        if (confirm("Mark all videos in this section as completed?")) {
          const courseData = window.COURSE_DATA;
          const sec = courseData?.sections?.find(s => s.id === secId || s.slug === secId);
          if (sec) {
            for (const ch of sec.chapters) {
              for (const v of ch.videos) {
                state.progress[v.id] = { status: "completed", updatedAt: Date.now() };
              }
            }
            saveState();
            syncUI();
          }
        }
      }

      // Reset section
      const resetSecBtn = e.target.closest("[data-action='reset-section']");
      if (resetSecBtn) {
        const secId = resetSecBtn.getAttribute("data-section-id");
        if (confirm("Reset progress for this section?")) {
          const courseData = window.COURSE_DATA;
          const sec = courseData?.sections?.find(s => s.id === secId || s.slug === secId);
          if (sec) {
            for (const ch of sec.chapters) {
              for (const v of ch.videos) {
                delete state.progress[v.id];
              }
            }
            saveState();
            syncUI();
          }
        }
      }

      // Theme toggle
      if (e.target.closest("#theme-toggle-btn")) {
        toggleTheme();
      }

      // Backup modal trigger
      if (e.target.closest("#backup-modal-btn")) {
        openModal("backup-modal");
      }

      // Modal close triggers
      if (e.target.closest("[data-close-modal]")) {
        const modal = e.target.closest(".modal-backdrop");
        if (modal) modal.classList.add("hidden");
      }

      // Search modal triggers (Desktop & Mobile)
      if (e.target.closest("#search-trigger-btn") || e.target.closest("#mobile-search-trigger")) {
        openModal("search-modal");
        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.focus();
        return;
      }

      // Desktop Collapsible Sidebar Toggle Pill (Like Astro site)
      const sidebarToggleBtn = e.target.closest("#sidebar-toggle-btn");
      if (sidebarToggleBtn) {
        e.preventDefault();
        const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
        try {
          localStorage.setItem("sidebar-collapsed", isCollapsed ? "true" : "false");
        } catch (err) {}
        return;
      }

      // Expand all / Collapse all sections in sidebar
      const toggleAllBtn = e.target.closest("#toggle-all-sections-btn");
      if (toggleAllBtn) {
        e.preventDefault();
        const allDetails = document.querySelectorAll("#course-sidebar details");
        const anyClosed = Array.from(allDetails).some(d => !d.open);
        allDetails.forEach(d => { d.open = anyClosed; });
        const toggleText = toggleAllBtn.querySelector(".toggle-text");
        if (toggleText) {
          toggleText.textContent = anyClosed ? "Collapse all" : "Expand all";
        }
        return;
      }

      // Mobile sidebar toggle & close
      if (e.target.closest("#mobile-sidebar-toggle")) {
        const sidebar = document.getElementById("course-sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");
        if (sidebar) sidebar.classList.remove("-translate-x-full");
        if (backdrop) backdrop.classList.remove("hidden");
        return;
      }

      if (e.target.closest("#mobile-sidebar-close-btn") || e.target.closest("#sidebar-backdrop")) {
        const sidebar = document.getElementById("course-sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");
        if (sidebar) sidebar.classList.add("-translate-x-full");
        if (backdrop) backdrop.classList.add("hidden");
        return;
      }

      // Close mobile sidebar when navigating to an item on small screens (< 1024px)
      if (window.innerWidth < 1024 && e.target.closest("#course-sidebar a")) {
        const sidebar = document.getElementById("course-sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");
        if (sidebar) sidebar.classList.add("-translate-x-full");
        if (backdrop) backdrop.classList.add("hidden");
      }
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", e => {
      // Ctrl+K or Cmd+K for search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const searchModal = document.getElementById("search-modal");
        if (searchModal && searchModal.classList.contains("hidden")) {
          openModal("search-modal");
          const searchInput = document.getElementById("search-input");
          if (searchInput) searchInput.focus();
        } else if (searchModal) {
          closeModal("search-modal");
        }
      }
      // Escape closes modals
      if (e.key === "Escape") {
        closeModal("search-modal");
        closeModal("backup-modal");
      }
    });

    // Backup actions
    const btnExport = document.getElementById("btn-export-backup");
    if (btnExport) btnExport.addEventListener("click", exportProgressJSON);

    const btnReset = document.getElementById("btn-reset-backup");
    if (btnReset) btnReset.addEventListener("click", resetAllProgress);

    const fileInput = document.getElementById("import-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", e => {
        if (e.target.files && e.target.files[0]) {
          importProgressJSON(e.target.files[0]);
        }
      });
    }

    // Interactive Search
    const searchInput = document.getElementById("search-input");
    const searchResults = document.getElementById("search-results");
    if (searchInput && searchResults) {
      searchInput.addEventListener("input", e => {
        const q = e.target.value.toLowerCase().trim();
        if (!q || !window.COURSE_DATA) {
          searchResults.innerHTML = `<div class="p-6 text-center text-xs text-neutral-500">Type to search ${window.COURSE_DATA?.totalVideos || 378} videos across 28 modules...</div>`;
          return;
        }

        const matches = [];
        for (const sec of window.COURSE_DATA.sections) {
          for (const ch of sec.chapters) {
            for (const v of ch.videos) {
              const inTitle = v.title.toLowerCase().includes(q);
              const inDesc = v.description.toLowerCase().includes(q);
              const inConcepts = ch.keyConcepts.some(c => c.toLowerCase().includes(q));
              const inRefs = v.references.some(r => r.label.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
              if (inTitle || inDesc || inConcepts || inRefs) {
                matches.push({ sec, ch, v });
              }
              if (matches.length >= 30) break;
            }
            if (matches.length >= 30) break;
          }
          if (matches.length >= 30) break;
        }

        if (matches.length === 0) {
          searchResults.innerHTML = `<div class="p-6 text-center text-xs text-neutral-500">No matching videos found for "${q}".</div>`;
          return;
        }

        const metaBase = document.querySelector('meta[name="base-url"]')?.getAttribute('content');
        const baseUrl = metaBase ? (metaBase.endsWith('/') ? metaBase : `${metaBase}/`) : (window.location.pathname.startsWith('/nodejs') ? '/nodejs/' : '/');

        searchResults.innerHTML = matches.map(m => `
          <a href="${baseUrl}sections/${m.sec.slug}/#video-${m.v.id}" class="block p-3 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border-b border-neutral-100 dark:border-neutral-800/60 last:border-0" onclick="document.getElementById('search-modal').classList.add('hidden')">
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="text-[11px] font-semibold text-blue-600 dark:text-blue-400">§${m.ch.id} • ${m.sec.title}</span>
              <span class="text-[10px] font-mono text-neutral-500">${m.v.durationText}</span>
            </div>
            <div class="text-xs font-medium text-neutral-900 dark:text-neutral-100">${m.v.title}</div>
            ${m.v.description ? `<p class="text-[11px] text-neutral-500 line-clamp-1 mt-0.5">${m.v.description}</p>` : ''}
          </a>
        `).join("");
      });
    }

    // Fluid header scroll elevation
    const mainHeader = document.getElementById("main-header");
    if (mainHeader) {
      const handleScroll = () => {
        if (window.scrollY > 8) {
          mainHeader.classList.add("shadow-sm");
        } else {
          mainHeader.classList.remove("shadow-sm");
        }
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
    }

    // Initial hash handling on page load (auto opens parent chapter, scrolls, and glows)
    if (window.location.hash) {
      const initialHash = window.location.hash.replace("#", "");
      if (initialHash.startsWith("video-") || initialHash.startsWith("flashcards-") || initialHash.startsWith("summary-btn-")) {
        setTimeout(() => {
          handleSidebarNavigation(initialHash);
        }, 200);
      }
    }

    // Hash change handler for anchor navigation
    window.addEventListener("hashchange", () => {
      if (window.location.hash) {
        const hash = window.location.hash.replace("#", "");
        if (hash.startsWith("video-") || hash.startsWith("flashcards-") || hash.startsWith("summary-btn-")) {
          handleSidebarNavigation(hash);
        }
      }
    });

    // ScrollSpy observer: dynamically sync active sidebar item while reading lessons
    const videoCards = document.querySelectorAll(".video-card[data-video-key]");
    if (videoCards.length > 0 && "IntersectionObserver" in window) {
      let activeSpiedKey = null;
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const key = entry.target.getAttribute("data-video-key");
              if (key && key !== activeSpiedKey) {
                activeSpiedKey = key;
                updateActiveSidebarItem(key);
              }
            }
          });
        },
        {
          rootMargin: "-15% 0px -60% 0px",
          threshold: 0
        }
      );
      videoCards.forEach(card => observer.observe(card));
    }

    // Initialize Flashcard Badges and triggers
    initFlashcardSystem();
  });

  // =========================================================================
  // FLASHCARD & MCQ STUDY ENGINE
  // =========================================================================
  const FC_STORAGE_KEY = "nodejs_course_tracker_mcq_flashcards_v1";
  let fcState = {
    version: 1,
    decks: {} // [deckId]: { cards: { [cardId]: { status: 'mastered'|'needs_review', selectedOpt: string, isCorrect: boolean } } }
  };

  function loadFcState() {
    try {
      const raw = localStorage.getItem(FC_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.decks) {
          fcState = { ...fcState, ...parsed };
        }
      }
    } catch (e) {
      console.warn("Could not load flashcard progress", e);
    }
  }

  function saveFcState() {
    try {
      localStorage.setItem(FC_STORAGE_KEY, JSON.stringify(fcState));
    } catch (e) {
      console.error("Could not save flashcard progress", e);
    }
  }

  loadFcState();

  const deckCache = {};
  let currentDeck = null;
  let currentCardIndex = 0;
  let isCardFlipped = false;
  let isOptionLocked = false;
  let activeAttemptedOpts = new Set();

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatExplanation(text) {
    if (!text) return "";
    const escaped = escapeHtml(text);
    return escaped.replace(/`([^`]+)`/g, '<code class="fc-inline-code">$1</code>');
  }

  function buildGoogleDorkUrl(citation) {
    if (!citation) return "https://www.google.com/search?q=nodejs+documentation";
    
    // Take primary specification citation before " / " if dual-cited
    const primaryPart = citation.split("/")[0].trim();
    
    let query = "";
    if (/ECMA|TC39|ECMAScript/i.test(primaryPart)) {
      query = `site:tc39.es/ecma262/ "${primaryPart.replace(/[§]/g, "").trim()}"`;
    } else if (/Node\.js|Nodejs|nodejs\.org/i.test(primaryPart)) {
      query = `site:nodejs.org/api/ "${primaryPart.replace(/[§]/g, "").trim()}"`;
    } else if (/MDN|Mozilla/i.test(primaryPart)) {
      query = `site:developer.mozilla.org "${primaryPart.replace(/[§]/g, "").trim()}"`;
    } else if (/Fastify/i.test(primaryPart)) {
      query = `site:fastify.dev/docs/ "${primaryPart.replace(/[§]/g, "").trim()}"`;
    } else if (/libuv/i.test(primaryPart)) {
      query = `site:docs.libuv.org "${primaryPart.replace(/[§]/g, "").trim()}"`;
    } else if (/OWASP/i.test(primaryPart)) {
      query = `site:cheatsheetseries.owasp.org "${primaryPart.replace(/[§]/g, "").trim()}"`;
    } else {
      query = `site:nodejs.org/api/ OR site:developer.mozilla.org "${primaryPart.replace(/[§]/g, "").trim()}"`;
    }
    
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  function updateBackResultBanner(type, attemptNum = 1) {
    const resultBanner = document.getElementById("fc-result-banner");
    const resultIcon = document.getElementById("fc-result-icon");
    const resultText = document.getElementById("fc-result-text");
    if (!resultBanner) return;

    if (type === "correct") {
      resultBanner.className = "fc-result-banner is-correct";
      if (resultIcon) resultIcon.textContent = attemptNum === 1 ? "🎉" : "✓";
      if (resultText) {
        resultText.textContent = attemptNum === 1
          ? "Mastered on 1st attempt! Complete breakdown:"
          : `Solved on attempt ${attemptNum}. Complete breakdown:`;
      }
    } else if (type === "wrong") {
      resultBanner.className = "fc-result-banner is-wrong";
      if (resultIcon) resultIcon.textContent = "⚠️";
      if (resultText) resultText.textContent = "Review Required (Options Exhausted). Complete breakdown:";
    } else {
      resultBanner.className = "fc-result-banner is-neutral";
      if (resultIcon) resultIcon.textContent = "💡";
      if (resultText) resultText.textContent = "Concept Breakdown & Deep Dive:";
    }
  }

  function setupFlashcardScrollHandlers() {
    const frontBody = document.querySelector(".fc-face-front .fc-face-body");
    const backBody = document.querySelector(".fc-face-back .fc-face-body");
    const codeBox = document.querySelector(".fc-face-back .code-snippet-box");

    const attachWheel = (container) => {
      if (!container || container._wheelBound) return;
      container._wheelBound = true;
      container.addEventListener("wheel", (e) => {
        // If user holds Shift or deltaX dominates, allow horizontal scroll natively
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          return;
        }
        if (container.scrollHeight > container.clientHeight) {
          container.scrollTop += e.deltaY;
        }
      }, { passive: true });
    };

    if (frontBody) attachWheel(frontBody);
    if (backBody) attachWheel(backBody);

    if (codeBox && backBody && !codeBox._wheelBound) {
      codeBox._wheelBound = true;
      codeBox.addEventListener("wheel", (e) => {
        // When user scrolls horizontally on code, NEVER interfere with horizontal code scrolling!
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          return;
        }
        // Pure vertical scroll intent -> forward smoothly to backBody
        if (backBody.scrollHeight > backBody.clientHeight) {
          backBody.scrollTop += e.deltaY;
        }
      }, { passive: true });
    }
  }

  function highlightSyntax(code) {
    if (!code) return "";
    const lines = code.split("\n");
    const processedLines = lines.map(line => {
      // Shell CLI detection: e.g. "$ node ..." or "$ bun ..." or "# docker ..."
      const shellMatch = line.match(/^(\s*)([%#$])\s+([a-zA-Z0-9_.-]+)(.*)$/);
      if (shellMatch) {
        const indent = escapeHtml(shellMatch[1]);
        const prompt = escapeHtml(shellMatch[2]);
        const cmd = escapeHtml(shellMatch[3]);
        const rest = shellMatch[4];
        const restHighlighted = rest.replace(/(--?[a-zA-Z0-9_.:/-]+)/g, '<span class="tok-flag">$1</span>');
        return `${indent}<span class="tok-prompt">${prompt}</span> <span class="tok-cmd">${cmd}</span>${restHighlighted}`;
      }

      // Comments
      const commentIdx = line.indexOf("//");
      let codePart = line;
      let commentPart = "";
      if (commentIdx !== -1) {
        codePart = line.substring(0, commentIdx);
        commentPart = `<span class="tok-comment">${escapeHtml(line.substring(commentIdx))}</span>`;
      }

      let escaped = escapeHtml(codePart);

      // 1. Stash string literals into placeholders
      const strings = [];
      escaped = escaped.replace(/(&quot;.*?&quot;)/g, (match) => {
        const idx = strings.length;
        strings.push(`<span class="tok-str">${match}</span>`);
        return `___STR_PLACEHOLDER_${idx}___`;
      });

      // 2. Stash annotations into placeholders
      const annos = [];
      escaped = escaped.replace(/(@[A-Z][a-zA-Z0-9_]*)/g, (match) => {
        const idx = annos.length;
        annos.push(`<span class="tok-anno">${match}</span>`);
        return `___ANNO_PLACEHOLDER_${idx}___`;
      });

      // 3. Keywords
      const kwRegex = /\b(async|await|function|class|const|let|var|return|new|this|super|throw|try|catch|finally|import|export|from|default|if|else|while|for|of|in|switch|case|break|continue|instanceof|typeof|void|delete|null|true|false|undefined|yield)\b/g;
      escaped = escaped.replace(kwRegex, '<span class="tok-kw">$1</span>');

      // 4. Common JavaScript & Node.js Types & Globals
      const typeRegex = /\b(Buffer|EventEmitter|Stream|Readable|Writable|Transform|Promise|Worker|MessageChannel|AsyncLocalStorage|Set|Map|WeakMap|WeakSet|Array|Object|String|Number|BigInt|Boolean|Symbol|Error|TypeError|RangeError|AbortController|AbortSignal|URL|URLSearchParams|Server|Socket|FastifyInstance|Request|Response|NextFunction|process|global|console)\b/g;
      escaped = escaped.replace(typeRegex, '<span class="tok-type">$1</span>');

      // 5. Numbers
      escaped = escaped.replace(/\b(\d+L?|\d+\.\d+f?|0x[0-9a-fA-F]+)\b/g, '<span class="tok-num">$1</span>');

      // 6. Restore annotations and strings
      annos.forEach((val, idx) => {
        escaped = escaped.replace(`___ANNO_PLACEHOLDER_${idx}___`, val);
      });
      strings.forEach((val, idx) => {
        escaped = escaped.replace(`___STR_PLACEHOLDER_${idx}___`, val);
      });

      return escaped + commentPart;
    });

    return processedLines.join("\n");
  }

  function getFlashcardUrl(deckId) {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return `/data/flashcards/${deckId}.json`;
    }
    const metaBase = document.querySelector('meta[name="base-url"]')?.getAttribute('content');
    const base = metaBase ? (metaBase.endsWith('/') ? metaBase : metaBase + '/') : '/';
    return `${base}data/flashcards/${deckId}.json`;
  }

  async function fetchDeck(deckId) {
    if (deckCache[deckId]) return deckCache[deckId];
    const url = getFlashcardUrl(deckId);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to load flashcard deck: ${deckId} (HTTP ${resp.status})`);
    }
    const data = await resp.json();
    deckCache[deckId] = data;
    return data;
  }

  function getDeckMasteryStats(deckId, totalCards) {
    const deckRecord = fcState.decks[deckId];
    if (!deckRecord || !deckRecord.cards) {
      return { mastered: 0, needsReview: 0, total: totalCards || 0, pct: 0 };
    }
    let mastered = 0;
    let needsReview = 0;
    Object.values(deckRecord.cards).forEach(c => {
      if (c.status === "mastered") mastered++;
      else if (c.status === "needs_review") needsReview++;
    });
    const total = totalCards || Object.keys(deckRecord.cards).length || 1;
    const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
    return { mastered, needsReview, total, pct };
  }

  let fcManifestCache = null;
  async function fetchFlashcardManifest() {
    if (fcManifestCache) return fcManifestCache;
    try {
      const url = getFlashcardUrl("manifest");
      const resp = await fetch(url);
      if (resp.ok) {
        fcManifestCache = await resp.json();
      }
    } catch (e) {
      // Ignore or silent fallback
    }
    return fcManifestCache;
  }

  async function syncFlashcardBadges() {
    const manifest = await fetchFlashcardManifest();
    const manifestMap = {};
    if (manifest && manifest.decks) {
      manifest.decks.forEach(d => {
        manifestMap[d.deckId] = d.totalCards;
      });
    }

    const badges = document.querySelectorAll("[data-deck-badge]");
    badges.forEach(badge => {
      const deckId = badge.getAttribute("data-deck-badge");
      if (!deckId) return;
      let total = manifestMap[deckId];
      if (total === undefined) {
        const totalAttr = badge.getAttribute("data-deck-total");
        total = totalAttr ? parseInt(totalAttr, 10) : 8;
      }
      const stats = getDeckMasteryStats(deckId, total);
      badge.textContent = `${stats.mastered}/${total} Mastered`;
      if (stats.mastered === total && total > 0) {
        badge.classList.remove("bg-white", "dark:bg-[#161b22]");
        badge.classList.add("bg-emerald-100", "dark:bg-emerald-950/60", "text-emerald-700", "dark:text-emerald-300");
      }
    });
  }

  async function openFlashcards(deckId) {
    const modal = document.getElementById("flashcard-modal");
    if (!modal) return;

    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");

    const titleEl = document.getElementById("fc-modal-title");
    if (titleEl) titleEl.textContent = `Loading ${deckId}...`;

    try {
      currentDeck = await fetchDeck(deckId);
      currentCardIndex = 0;
      isCardFlipped = false;
      isOptionLocked = false;
      activeAttemptedOpts = new Set();
      renderCurrentCard();
      setupFlashcardScrollHandlers();
      window.addEventListener("keydown", handleFlashcardKeydown);
    } catch (err) {
      console.error(err);
      if (titleEl) titleEl.textContent = `Error loading deck: ${deckId}`;
    }
  }

  function closeAskAIDock() {
    const dock = document.getElementById("fc-ask-ai-slide-dock");
    const trigger = document.getElementById("fc-ask-ai-slide-trigger");
    if (dock) dock.classList.remove("is-expanded");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function toggleAskAIDock() {
    const dock = document.getElementById("fc-ask-ai-slide-dock");
    const trigger = document.getElementById("fc-ask-ai-slide-trigger");
    if (!dock) return;
    const isExpanded = dock.classList.contains("is-expanded");
    if (isExpanded) {
      dock.classList.remove("is-expanded");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    } else {
      dock.classList.add("is-expanded");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
    }
  }

  function closeFlashcards() {
    closeAskAIDock();
    const modal = document.getElementById("flashcard-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    window.removeEventListener("keydown", handleFlashcardKeydown);
    syncFlashcardBadges();
  }

  function renderCurrentCard() {
    if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) return;
    closeAskAIDock();

    const card = currentDeck.cards[currentCardIndex];
    const total = currentDeck.cards.length;
    const deckId = currentDeck.deckId;

    // Header updates
    const titleEl = document.getElementById("fc-modal-title");
    if (titleEl) titleEl.textContent = currentDeck.title;

    const counterEl = document.getElementById("fc-deck-counter");
    if (counterEl) counterEl.textContent = `Card ${currentCardIndex + 1} of ${total}`;

    const navIndicator = document.getElementById("fc-nav-card-indicator");
    if (navIndicator) navIndicator.textContent = `${currentCardIndex + 1} / ${total}`;

    const masteryStats = getDeckMasteryStats(deckId, total);
    const masteryStatEl = document.getElementById("fc-mastery-stat");
    if (masteryStatEl) {
      masteryStatEl.textContent = `${masteryStats.mastered} Mastered (${masteryStats.pct}%)`;
    }

    const progressBar = document.getElementById("fc-progress-bar");
    if (progressBar) {
      progressBar.style.width = `${masteryStats.pct}%`;
    }

    // Prev / Next button states
    const btnPrev = document.getElementById("fc-btn-prev");
    const btnNext = document.getElementById("fc-btn-next");
    if (btnPrev) btnPrev.disabled = currentCardIndex === 0;
    if (btnNext) btnNext.disabled = currentCardIndex === total - 1;

    // Reset flip state
    isCardFlipped = false;
    const cardInner = document.getElementById("fc-card-inner");
    if (cardInner) cardInner.classList.remove("is-flipped");

    // Front Face Rendering
    const badgeEl = document.getElementById("fc-card-badge");
    if (badgeEl) badgeEl.textContent = `${card.category || "General"} • ${card.difficulty || "Beginner"}`;

    const savedCardState = fcState.decks[deckId]?.cards?.[card.id];
    const statusEl = document.getElementById("fc-card-status");
    if (statusEl) {
      if (savedCardState?.status === "mastered") {
        statusEl.textContent = "✅ Mastered";
        statusEl.className = "text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800";
      } else if (savedCardState?.status === "needs_review") {
        statusEl.textContent = "⚠️ Needs Review";
        statusEl.className = "text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800";
      } else {
        statusEl.textContent = "Not Answered";
        statusEl.className = "text-[10px] font-mono px-2 py-0.5 rounded border border-[#d0d7de] dark:border-[#30363d] text-[#656d76] dark:text-[#8b949e]";
      }
    }

    const questionEl = document.getElementById("fc-question-text");
    if (questionEl) questionEl.textContent = card.question;

    // Active attempts reset and populate from saved state if any
    activeAttemptedOpts = new Set();
    if (savedCardState) {
      if (Array.isArray(savedCardState.attempts)) {
        savedCardState.attempts.forEach(id => activeAttemptedOpts.add(id));
      } else if (savedCardState.selectedOpt) {
        activeAttemptedOpts.add(savedCardState.selectedOpt);
      }
    }

    // Attempt feedback banner
    const attemptBanner = document.getElementById("fc-attempt-banner");
    if (attemptBanner) {
      if (savedCardState) {
        if (savedCardState.isCorrect) {
          const count = activeAttemptedOpts.size || 1;
          attemptBanner.className = "fc-attempt-banner is-correct";
          attemptBanner.innerHTML = count === 1
            ? "<span>🎉 Mastered on 1st attempt! Excellent recall.</span>"
            : `<span>✓ Mastered (Solved on attempt ${count})</span>`;
          attemptBanner.classList.remove("hidden");
        } else {
          attemptBanner.className = "fc-attempt-banner is-wrong";
          attemptBanner.innerHTML = "<span>⚠️ Options exhausted. Review the explanation.</span>";
          attemptBanner.classList.remove("hidden");
        }
      } else {
        attemptBanner.className = "fc-attempt-banner hidden";
        attemptBanner.innerHTML = "";
      }
    }

    // MCQ Options
    const optContainer = document.getElementById("fc-options-container");
    if (optContainer) {
      optContainer.innerHTML = "";
      isOptionLocked = !!savedCardState;

      card.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mcq-option-btn";
        btn.setAttribute("data-opt-id", opt.id);

        const badge = document.createElement("span");
        badge.className = "mcq-badge";
        badge.textContent = opt.id;

        const textSpan = document.createElement("span");
        textSpan.className = "flex-1";
        textSpan.textContent = opt.text;

        btn.appendChild(badge);
        btn.appendChild(textSpan);

        if (savedCardState) {
          btn.disabled = true;
          if (opt.correct) {
            btn.classList.add("opt-correct");
          } else if (activeAttemptedOpts.has(opt.id) && !opt.correct) {
            btn.classList.add("opt-wrong");
          }
        } else {
          btn.addEventListener("click", () => handleOptionSelection(opt.id));
        }

        optContainer.appendChild(btn);
      });
    }

    // Back Face Rendering
    if (savedCardState?.isCorrect) {
      const count = activeAttemptedOpts.size || 1;
      updateBackResultBanner("correct", count);
    } else if (savedCardState && !savedCardState.isCorrect) {
      updateBackResultBanner("wrong");
    } else {
      updateBackResultBanner("neutral");
    }

    // Correct Answer Pill
    const correctOpt = card.options.find(o => o.correct);
    const correctOptEl = document.getElementById("fc-correct-answer-text");
    if (correctOptEl && correctOpt) {
      correctOptEl.innerHTML = `Option ${correctOpt.id}: ${formatExplanation(correctOpt.text)}`;
    }

    const expText = document.getElementById("fc-explanation-text");
    if (expText) expText.innerHTML = formatExplanation(card.explanation);

    const codeContainer = document.getElementById("fc-code-container");
    const codeSnippet = document.getElementById("fc-code-snippet");
    if (codeContainer && codeSnippet) {
      if (card.codeSnippet) {
        codeContainer.classList.remove("hidden");
        codeSnippet.innerHTML = highlightSyntax(card.codeSnippet);
      } else {
        codeContainer.classList.add("hidden");
        codeSnippet.innerHTML = "";
      }
    }

    const pitfallContainer = document.getElementById("fc-pitfall-container");
    const pitfallText = document.getElementById("fc-pitfall-text");
    if (pitfallContainer && pitfallText) {
      if (card.pitfall) {
        pitfallContainer.classList.remove("hidden");
        pitfallText.innerHTML = formatExplanation(card.pitfall);
      } else {
        pitfallContainer.classList.add("hidden");
        pitfallText.innerHTML = "";
      }
    }

    const citationText = document.getElementById("fc-citation-text");
    const citationLink = document.getElementById("fc-citation-link");
    const citationStr = card.citation || "Node.js & ECMAScript Specification";
    if (citationText) citationText.textContent = citationStr;
    if (citationLink) {
      citationLink.href = buildGoogleDorkUrl(citationStr);
      citationLink.title = `Search Google: ${citationStr}`;
    }

    setupFlashcardScrollHandlers();
  }

  function handleOptionSelection(optId) {
    if (isOptionLocked || !currentDeck) return;
    if (activeAttemptedOpts.has(optId)) return; // already tried this incorrect option

    const card = currentDeck.cards[currentCardIndex];
    const deckId = currentDeck.deckId;
    const selectedOption = card.options.find(o => o.id === optId);
    const isCorrect = selectedOption ? !!selectedOption.correct : false;
    const attemptBanner = document.getElementById("fc-attempt-banner");
    const totalOpts = card.options.length;

    activeAttemptedOpts.add(optId);

    if (!isCorrect) {
      // Disable clicked button and mark opt-wrong
      const clickedBtn = document.querySelector(`#fc-options-container .mcq-option-btn[data-opt-id="${optId}"]`);
      if (clickedBtn) {
        clickedBtn.disabled = true;
        clickedBtn.classList.add("opt-wrong");
      }

      const remainingChoices = totalOpts - activeAttemptedOpts.size;

      // Udemy multi-attempt: if choices remain (> 1), allow retrying!
      if (remainingChoices > 1) {
        if (attemptBanner) {
          attemptBanner.className = "fc-attempt-banner is-wrong";
          attemptBanner.innerHTML = `<span>❌ Incorrect. Please try again! (${remainingChoices} options remaining)</span>`;
          attemptBanner.classList.remove("hidden");
        }
        return;
      }

      // Exhausted all options! (Only 1 remaining choice unselected)
      isOptionLocked = true;

      // Reveal correct option and disable all options
      const optionButtons = document.querySelectorAll("#fc-options-container .mcq-option-btn");
      optionButtons.forEach(btn => {
        btn.disabled = true;
        const bId = btn.getAttribute("data-opt-id");
        const optObj = card.options.find(o => o.id === bId);
        if (optObj && optObj.correct) {
          btn.classList.add("opt-correct");
        }
      });

      if (attemptBanner) {
        attemptBanner.className = "fc-attempt-banner is-wrong";
        attemptBanner.innerHTML = "<span>❌ Options exhausted. Reviewing concept breakdown...</span>";
        attemptBanner.classList.remove("hidden");
      }

      // Save state as needs_review
      if (!fcState.decks[deckId]) fcState.decks[deckId] = { cards: {} };
      fcState.decks[deckId].cards[card.id] = {
        status: "needs_review",
        selectedOpt: optId,
        attempts: Array.from(activeAttemptedOpts),
        isCorrect: false,
        exhausted: true,
        updatedAt: Date.now()
      };
      saveFcState();

      // Status badge
      const statusEl = document.getElementById("fc-card-status");
      if (statusEl) {
        statusEl.textContent = "⚠️ Needs Review";
        statusEl.className = "text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800";
      }

      // Mastery stats & progress bar
      const masteryStats = getDeckMasteryStats(deckId, currentDeck.cards.length);
      const masteryStatEl = document.getElementById("fc-mastery-stat");
      if (masteryStatEl) masteryStatEl.textContent = `${masteryStats.mastered} Mastered (${masteryStats.pct}%)`;
      const progressBar = document.getElementById("fc-progress-bar");
      if (progressBar) progressBar.style.width = `${masteryStats.pct}%`;

      // Auto flip after 750ms so user clearly sees the correct option highlighted
      setTimeout(() => {
        updateBackResultBanner("wrong");
        flipCard(true);
      }, 750);

    } else {
      // Correct choice!
      isOptionLocked = true;
      const attemptNum = activeAttemptedOpts.size;

      // Mark correct option and disable all
      const optionButtons = document.querySelectorAll("#fc-options-container .mcq-option-btn");
      optionButtons.forEach(btn => {
        btn.disabled = true;
        const bId = btn.getAttribute("data-opt-id");
        if (bId === optId) {
          btn.classList.add("opt-correct");
        }
      });

      if (attemptBanner) {
        attemptBanner.className = "fc-attempt-banner is-correct";
        if (attemptNum === 1) {
          attemptBanner.innerHTML = "<span>🎉 Correct on first attempt! Excellent recall.</span>";
        } else {
          attemptBanner.innerHTML = `<span>✓ Correct! (Solved on attempt ${attemptNum})</span>`;
        }
        attemptBanner.classList.remove("hidden");
      }

      // Save state as mastered
      if (!fcState.decks[deckId]) fcState.decks[deckId] = { cards: {} };
      fcState.decks[deckId].cards[card.id] = {
        status: "mastered",
        selectedOpt: optId,
        attempts: Array.from(activeAttemptedOpts),
        isCorrect: true,
        updatedAt: Date.now()
      };
      saveFcState();

      // Status badge
      const statusEl = document.getElementById("fc-card-status");
      if (statusEl) {
        statusEl.textContent = "✅ Mastered";
        statusEl.className = "text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800";
      }

      // Mastery stats & progress bar
      const masteryStats = getDeckMasteryStats(deckId, currentDeck.cards.length);
      const masteryStatEl = document.getElementById("fc-mastery-stat");
      if (masteryStatEl) masteryStatEl.textContent = `${masteryStats.mastered} Mastered (${masteryStats.pct}%)`;
      const progressBar = document.getElementById("fc-progress-bar");
      if (progressBar) progressBar.style.width = `${masteryStats.pct}%`;

      // Auto flip after 600ms
      setTimeout(() => {
        updateBackResultBanner("correct", attemptNum);
        flipCard(true);
      }, 600);
    }
  }

  function flipCard(forceState) {
    isCardFlipped = typeof forceState === "boolean" ? forceState : !isCardFlipped;
    closeAskAIDock();
    const inner = document.getElementById("fc-card-inner");
    if (inner) {
      if (isCardFlipped) {
        inner.classList.add("is-flipped");
      } else {
        inner.classList.remove("is-flipped");
      }
    }
  }

  function setCardStatus(status) {
    if (!currentDeck) return;
    const card = currentDeck.cards[currentCardIndex];
    const deckId = currentDeck.deckId;

    if (!fcState.decks[deckId]) {
      fcState.decks[deckId] = { cards: {} };
    }
    const currentRecord = fcState.decks[deckId].cards[card.id] || {};
    fcState.decks[deckId].cards[card.id] = {
      ...currentRecord,
      status: status,
      isCorrect: status === "mastered",
      updatedAt: Date.now()
    };
    saveFcState();

    // Advance to next card if available
    if (currentCardIndex < currentDeck.cards.length - 1) {
      currentCardIndex++;
      renderCurrentCard();
    } else {
      renderCurrentCard();
    }
  }

  function handleFlashcardKeydown(e) {
    if (e.key === "Escape") {
      const dock = document.getElementById("fc-ask-ai-slide-dock");
      if (dock && dock.classList.contains("is-expanded")) {
        closeAskAIDock();
        e.preventDefault();
        return;
      }
      closeFlashcards();
      return;
    }

    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      flipCard();
    } else if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      if (currentCardIndex > 0) {
        currentCardIndex--;
        renderCurrentCard();
      }
    } else if (e.key === "ArrowRight" || e.key === "k" || e.key === "K") {
      e.preventDefault();
      if (currentDeck && currentCardIndex < currentDeck.cards.length - 1) {
        currentCardIndex++;
        renderCurrentCard();
      }
    } else if (!isCardFlipped && (e.key === "1" || e.key === "a" || e.key === "A")) {
      handleOptionSelection("A");
    } else if (!isCardFlipped && (e.key === "2" || e.key === "b" || e.key === "B")) {
      handleOptionSelection("B");
    } else if (!isCardFlipped && (e.key === "3" || e.key === "c" || e.key === "C")) {
      handleOptionSelection("C");
    } else if (!isCardFlipped && (e.key === "4" || e.key === "d" || e.key === "D")) {
      handleOptionSelection("D");
    } else if (isCardFlipped && (e.key === "1" || e.key === "r" || e.key === "R")) {
      setCardStatus("needs_review");
    } else if (isCardFlipped && (e.key === "2" || e.key === "m" || e.key === "M")) {
      setCardStatus("mastered");
    }
  }

  function initFlashcardSystem() {
    // Bind modal controls
    const btnClose = document.getElementById("fc-btn-close");
    if (btnClose) btnClose.addEventListener("click", closeFlashcards);

    const btnFlipFront = document.getElementById("fc-btn-flip-front");
    if (btnFlipFront) btnFlipFront.addEventListener("click", () => flipCard(true));

    const btnFlipBack = document.getElementById("fc-btn-flip-back");
    if (btnFlipBack) btnFlipBack.addEventListener("click", () => flipCard(false));

    const btnRateReview = document.getElementById("fc-btn-rate-review");
    if (btnRateReview) btnRateReview.addEventListener("click", () => setCardStatus("needs_review"));

    const btnRateMastered = document.getElementById("fc-btn-rate-mastered");
    if (btnRateMastered) btnRateMastered.addEventListener("click", () => setCardStatus("mastered"));

    const btnPrev = document.getElementById("fc-btn-prev");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (currentCardIndex > 0) {
          currentCardIndex--;
          renderCurrentCard();
        }
      });
    }

    const btnNext = document.getElementById("fc-btn-next");
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if (currentDeck && currentCardIndex < currentDeck.cards.length - 1) {
          currentCardIndex++;
          renderCurrentCard();
        }
      });
    }

    const btnShuffle = document.getElementById("fc-btn-shuffle");
    if (btnShuffle) {
      btnShuffle.addEventListener("click", () => {
        if (currentDeck && currentDeck.cards) {
          currentDeck.cards.sort(() => Math.random() - 0.5);
          currentCardIndex = 0;
          renderCurrentCard();
        }
      });
    }

    const btnResetDeck = document.getElementById("fc-btn-reset-deck");
    if (btnResetDeck) {
      btnResetDeck.addEventListener("click", () => {
        if (!currentDeck) return;
        if (confirm(`Reset all progress for ${currentDeck.title}?`)) {
          delete fcState.decks[currentDeck.deckId];
          saveFcState();
          renderCurrentCard();
          syncFlashcardBadges();
        }
      });
    }

    // Modal background click to close
    const modal = document.getElementById("flashcard-modal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeFlashcards();
      });
    }

    // Bind triggers on page
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-open-flashcards]");
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        const deckId = trigger.getAttribute("data-open-flashcards");
        if (deckId) openFlashcards(deckId);
        return;
      }

      // Ask AI slide dock trigger button (mobile toggle & click)
      const aiSlideTrigger = e.target.closest("#fc-ask-ai-slide-trigger");
      if (aiSlideTrigger) {
        e.preventDefault();
        e.stopPropagation();
        toggleAskAIDock();
        return;
      }

      const aiBtn = e.target.closest("[data-ask-ai-provider]");
      if (aiBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeAskAIDock();
        handleAskAIClick(aiBtn);
        return;
      }

      // Close slide dock if clicked outside dock
      if (!e.target.closest("#fc-ask-ai-slide-dock")) {
        closeAskAIDock();
      }
    });

    // Touch swipe gesture support for mobile
    const stage = document.querySelector(".fc-stage");
    if (stage) {
      let touchStartX = 0;
      let touchStartY = 0;
      stage.addEventListener("touchstart", (e) => {
        if (e.touches && e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      stage.addEventListener("touchend", (e) => {
        if (e.changedTouches && e.changedTouches.length === 1) {
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          const deltaY = e.changedTouches[0].clientY - touchStartY;
          // Predominantly horizontal swipe and minimum distance of 45px
          if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
            if (deltaX < 0) {
              // Swipe Left -> Next Card
              if (currentDeck && currentCardIndex < currentDeck.cards.length - 1) {
                currentCardIndex++;
                renderCurrentCard();
              }
            } else {
              // Swipe Right -> Prev Card
              if (currentCardIndex > 0) {
                currentCardIndex--;
                renderCurrentCard();
              }
            }
          }
        }
      }, { passive: true });
    }

    syncFlashcardBadges();
  }

  // =========================================================================
  // Ask AI Assistant URL Generator & Handler
  // =========================================================================
  const AI_PROVIDERS = {
    claude: {
      name: "Anthropic Claude",
      url: "https://claude.ai/new?q=%s"
    },
    chatgpt: {
      name: "OpenAI ChatGPT",
      url: "https://chatgpt.com/?q=%s"
    },
    mistral: {
      name: "Mistral Le Chat",
      url: "https://chat.mistral.ai/chat?q=%s"
    },
    gemini: {
      name: "Google Gemini",
      url: "https://www.google.com/search?udm=50&q=%s"
    },
    copilot: {
      name: "Bing CopilotSearch",
      url: "https://www.bing.com/copilotsearch?q=%s"
    },
    grok: {
      name: "xAI Grok",
      url: "https://grok.com/?q=%s"
    },
    brave: {
      name: "Brave Search",
      url: "https://search.brave.com/ask?q=%s"
    }
  };

  function handleAskAIClick(btn) {
    const providerKey = btn.getAttribute("data-ask-ai-provider");
    const provider = AI_PROVIDERS[providerKey];
    if (!provider) return;

    let prompt = "";
    const isFlashcard = btn.closest("#flashcard-modal") !== null || btn.getAttribute("data-context-type") === "flashcard";

    if (isFlashcard) {
      if (!currentDeck || !currentDeck.cards || !currentDeck.cards[currentCardIndex]) return;
      const card = currentDeck.cards[currentCardIndex];
      const correctOpt = card.options ? card.options.find(o => o.correct) : null;
      const pageUrl = window.location.href;

      prompt = `I am practicing JavaScript & Node.js multiple-choice flashcards from the course:
Deck: ${currentDeck.title || 'JavaScript & Node.js Mastery'}

Question:
${card.question}

Correct Answer:
${correctOpt ? `Option ${correctOpt.id}: ${correctOpt.text}` : 'See explanation'}

Concept Breakdown & Rationale:
${card.explanation || ''}
${card.codeSnippet ? `\nCode Snippet / Verification:\n${card.codeSnippet}\n` : ''}${card.pitfall ? `\nCommon Pitfall:\n${card.pitfall}\n` : ''}
Authoritative Source:
${card.citation || 'Node.js & MDN Web Docs'}

Reference URL:
${pageUrl}

Please provide an in-depth explanation of this concept, why this option is correct, how it works under the hood in V8 / libuv, and practical enterprise production best practices.`;
    } else {
      // Video lesson comprehensive study notes
      const videoCard = btn.closest(".video-card");
      const videoKey = videoCard ? videoCard.getAttribute("data-video-key") : null;
      const titleEl = videoCard ? videoCard.querySelector("[data-video-link] span") : null;
      const lessonTitle = titleEl ? titleEl.textContent.trim() : (videoCard ? videoCard.id : "Node.js & JavaScript Concept");

      // Extract notes text if available from the card
      const notesDetails = videoCard ? videoCard.querySelector(".video-notes-details") : null;
      let notesSummary = "";
      if (notesDetails) {
        const paras = notesDetails.querySelectorAll("p");
        paras.forEach(p => {
          const text = p.textContent.trim();
          if (text) notesSummary += text + "\n\n";
        });
        const codeEl = notesDetails.querySelector("pre code");
        if (codeEl) {
          notesSummary += "Code Snippet:\n" + codeEl.textContent.trim() + "\n\n";
        }
      }

      // Exact URL with anchor hash
      const pageUrl = videoKey
        ? `${window.location.origin}${window.location.pathname}#video-${videoKey}`
        : window.location.href;

      prompt = `I am studying this Node.js / JavaScript lesson from the LinkedIn Learning course notes:
Lesson Title: ${lessonTitle}

Key Concepts & Architecture:
${notesSummary.trim() || 'Node.js Architecture and Production Patterns'}

Reference URL:
${pageUrl}

Please explain these Node.js / JavaScript concepts thoroughly, including architectural implications, memory/runtime mechanics in V8 and libuv, common pitfalls to avoid, and concrete production code examples.`;
    }

    const finalUrl = provider.url.replace("%s", encodeURIComponent(prompt));
    window.open(finalUrl, "_blank", "noopener,noreferrer");
  }

  // Expose global tracker API
  window.CourseTracker = {
    getVideoStatus,
    setVideoStatus,
    cycleVideoStatus,
    getStats,
    getChapterStats,
    getPartStats,
    handleSidebarNavigation,
    updateActiveSidebarItem,
    updateActiveSidebarFlashcard,
    applySidebarHighlight,
    clearSidebarHighlight,
    syncUI,
    exportProgressJSON,
    resetAllProgress,
    openFlashcards,
    closeFlashcards,
    getDeckMasteryStats,
    syncFlashcardBadges,
    askAI: handleAskAIClick,
    AI_PROVIDERS
  };
})();




  // ==========================================
  // CHAPTER SUMMARY & ASK AI MODAL CONTROLLER
  // ==========================================
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function openChapterSummaryModal(chId) {
    const modal = document.getElementById("chapter-summary-modal");
    if (!modal || !window.COURSE_DATA) return;

    let targetChapter = null;
    let targetSection = null;

    for (const sec of window.COURSE_DATA.sections) {
      const ch = sec.chapters.find(c => c.id === chId || String(c.id) === String(chId));
      if (ch) {
        targetChapter = ch;
        targetSection = sec;
        break;
      }
    }

    if (!targetChapter) return;

    const titleEl = document.getElementById("ch-summary-modal-title");
    const idEl = document.getElementById("ch-summary-modal-id");
    const lessonsEl = document.getElementById("ch-summary-modal-lessons");
    const bodyEl = document.getElementById("ch-summary-modal-body");
    const aiButtonsEl = document.getElementById("ch-summary-modal-ai-buttons");

    if (titleEl) titleEl.textContent = targetChapter.title;
    if (idEl) idEl.textContent = "§" + targetChapter.id;
    if (lessonsEl) lessonsEl.textContent = targetChapter.videos.length + " Lessons • " + targetSection.title;

    const sum = targetChapter.summary || {
      executive_summary: targetChapter.title + " covers core Node.js E2 patterns and architecture.",
      mental_model: "Execution Context -> Event Loop -> I/O Demultiplexing.",
      key_takeaways: ["Production readiness", "Robust error boundaries"],
      interview_pitfalls: ["Asynchronous race conditions"]
    };

    let bodyHtml = `
      <!-- 1. Executive Architectural Summary -->
      <div class="ch-box-exec">
        <div class="ch-box-exec-title">
          <svg style="width: 14px; height: 14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span>Executive Architectural Summary</span>
        </div>
        <p class="ch-box-exec-content">${sum.executive_summary}</p>
      </div>

      <!-- 2. Mental Model -->
      <div class="ch-box-mental">
        <div class="ch-box-mental-title">
          <span>🧠</span>
          <span>Under-The-Hood Mental Model</span>
        </div>
        <div class="ch-box-mental-content">${sum.mental_model}</div>
      </div>

      <!-- 3. Key Concepts Badges (Clickable Chips) -->
      <div>
        <div class="ch-box-badges-title" style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <span>🏷️</span>
            <span>Core Concepts &amp; Technologies</span>
          </div>
          <span style="font-size: 0.625rem; font-weight: normal; color: #656d76;">(Click any concept to jump to study notes below)</span>
        </div>
        <div class="ch-badge-list">
          ${(targetChapter.keyConcepts || []).map((k, idx) => {
            const matchedVid = targetChapter.videos.find(v => v.title === k || v.title.toLowerCase() === k.toLowerCase()) || targetChapter.videos[idx];
            const targetNoteId = matchedVid ? `modal-note-${matchedVid.id}` : "";
            return `<button type="button" class="ch-pill-badge" data-concept-target="${targetNoteId}" title="Click to view detailed notes & code for '${escapeHtml(k)}'">
              <span>🏷️</span>
              <span>${escapeHtml(k)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>

      <!-- 4. Key Takeaways -->
      <div class="ch-box-takeaways">
        <div class="ch-box-takeaways-title">
          <span>✅</span>
          <span>Crucial Architectural Takeaways</span>
        </div>
        <ul class="ch-takeaways-list">
          ${(sum.key_takeaways || []).map(t => `<li class="ch-takeaways-item">${t}</li>`).join("")}
        </ul>
      </div>

      <!-- 5. Common Pitfalls & Interview Questions -->
      <div class="ch-box-pitfalls">
        <div class="ch-box-pitfalls-title">
          <span>⚠️</span>
          <span>Common Production Pitfalls &amp; Interview Gotchas</span>
        </div>
        <ul class="ch-pitfalls-list">
          ${(sum.interview_pitfalls || []).map(p => `<li class="ch-pitfalls-item">${p}</li>`).join("")}
        </ul>
      </div>

      <!-- 6. Detailed Lesson Study Notes & Code Snippets -->
      <div class="ch-notes-section">
        <div class="ch-notes-section-title">
          <svg style="width: 14px; height: 14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
          </svg>
          <span>Detailed Lesson Study Notes, Code &amp; Mental Models (${targetChapter.videos.length} Lessons)</span>
        </div>
        <div class="ch-lessons-list" style="display: flex; flex-direction: column; gap: 0.75rem;">
          ${targetChapter.videos.map((v, i) => {
            const def = v.notes?.definition || v.description || "";
            const mental = v.notes?.mentalModel || v.notes?.mental_model || "";
            const code = v.notes?.codeExample || v.notes?.code_example || "";
            const pitfalls = v.notes?.pitfalls || "";
            const refs = v.references || [];

            return `
              <details class="ch-lesson-card group/lcard" id="modal-note-${v.id}" open>
                <summary class="ch-lesson-summary-bar">
                  <div class="ch-lesson-summary-title">
                    <span style="font-family: monospace; font-size: 0.75rem; color: #0969da; font-weight: 700;">#${i + 1}</span>
                    <span style="font-weight: 700; font-size: 0.8125rem;">${escapeHtml(v.title)}</span>
                    ${v.durationText ? `<span style="font-size: 0.625rem; font-family: monospace; padding: 0.125rem 0.375rem; border-radius: 0.25rem; border: 1px solid #d0d7de; color: #656d76;">${escapeHtml(v.durationText)}</span>` : ''}
                  </div>
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <button type="button" class="ch-btn-jump-lesson" data-jump-video-id="${v.id}" data-section-slug="${targetSection.slug}" title="Jump to this lesson card on the page">
                      <span>📍</span>
                      <span>Jump to Lesson on Page ↗</span>
                    </button>
                    <svg style="width: 14px; height: 14px; transition: transform 0.2s;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </div>
                </summary>

                <div class="ch-lesson-body">
                  ${def ? `
                    <div style="margin-bottom: 0.5rem;">
                      <div class="ch-note-subbox-title" style="color: #0969da; font-weight: 700; font-size: 0.6875rem; text-transform: uppercase; margin-bottom: 0.25rem;">
                        <span>📖</span>
                        <span>Core Definition &amp; Architectural Role</span>
                      </div>
                      <p style="font-size: 0.75rem; line-height: 1.6; margin: 0;">${escapeHtml(def)}</p>
                    </div>
                  ` : ''}

                  ${mental ? `
                    <div class="ch-note-subbox" style="margin-bottom: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 0.375rem; background-color: rgba(130, 80, 223, 0.05); border: 1px solid rgba(130, 80, 223, 0.2);">
                      <div class="ch-note-subbox-title" style="color: #8250df; font-weight: 700; font-size: 0.6875rem; text-transform: uppercase; margin-bottom: 0.25rem;">
                        <span>🧠</span>
                        <span>Under-The-Hood Mental Model</span>
                      </div>
                      <p style="font-size: 0.75rem; line-height: 1.55; margin: 0; font-family: monospace; white-space: pre-line;">${escapeHtml(mental)}</p>
                    </div>
                  ` : ''}

                  ${code ? `
                    <div style="margin-bottom: 0.5rem;">
                      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
                        <div class="ch-note-subbox-title" style="color: #1a7f37; font-weight: 700; font-size: 0.6875rem; text-transform: uppercase; margin: 0;">
                          <span>💻</span>
                          <span>Production Code / CLI Example</span>
                        </div>
                        <button type="button" class="btn-copy-lesson-code" data-code="${encodeURIComponent(code)}" style="font-size: 0.6875rem; color: #0969da; cursor: pointer; background: transparent; border: 0; padding: 0; text-decoration: underline;">Copy Code</button>
                      </div>
                      <pre class="ch-note-code" style="margin: 0; padding: 0.5rem 0.75rem; border-radius: 0.375rem; background-color: #0d1117; color: #e6edf3; font-family: monospace; font-size: 0.71875rem; overflow-x: auto; border: 1px solid #30363d; white-space: pre;"><code>${escapeHtml(code)}</code></pre>
                    </div>
                  ` : ''}

                  ${pitfalls ? `
                    <div style="margin-bottom: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 0.375rem; background-color: rgba(210, 153, 34, 0.08); border: 1px solid rgba(210, 153, 34, 0.25);">
                      <div style="color: #9a6700; font-weight: 700; font-size: 0.6875rem; text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.25rem;">
                        <span>⚠️</span>
                        <span>Common Production Pitfall &amp; Gotcha</span>
                      </div>
                      <p style="font-size: 0.75rem; line-height: 1.55; margin: 0; color: #656d76;">${escapeHtml(pitfalls)}</p>
                    </div>
                  ` : ''}

                  ${refs && refs.length > 0 ? `
                    <div style="padding-top: 0.375rem; border-top: 1px solid rgba(120, 120, 120, 0.2);">
                      <div style="font-size: 0.625rem; font-weight: 700; text-transform: uppercase; color: #656d76; margin-bottom: 0.25rem;">Official Documentation Anchor Links:</div>
                      <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        ${refs.map(r => `
                          <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" style="font-size: 0.6875rem; color: #0969da; text-decoration: underline; display: inline-flex; align-items: center; gap: 0.25rem;">
                            <span>↗</span>
                            <span style="font-weight: 600;">${escapeHtml(r.label)}</span>
                            ${r.description ? `<span style="color: #656d76; text-decoration: none;">— ${escapeHtml(r.description)}</span>` : ''}
                          </a>
                        `).join("")}
                      </div>
                    </div>
                  ` : ''}
                </div>
              </details>
            `;
          }).join("")}
        </div>
      </div>
    `;

    if (bodyEl) bodyEl.innerHTML = bodyHtml;

    // AI Prompt Buttons
    if (aiButtonsEl) {
      const prompts = [
        { icon: "💡", label: "Explain Simply", prompt: "Explain the core concepts of §" + targetChapter.id + ": \"" + targetChapter.title + "\" in Node.js with a real-world analogy and runnable code snippet." },
        { icon: "🎯", label: "Interview Drill", prompt: "Conduct a senior Node.js E2 technical interview drill on \"" + targetChapter.title + "\". Ask me 3 challenging questions focusing on edge cases, libuv/V8 internals, and failure recovery." },
        { icon: "🛡️", label: "Production Gotchas", prompt: "What are the most common production memory leaks, race conditions, or performance bottlenecks when implementing \"" + targetChapter.title + "\" in Node.js, and how are they diagnosed?" }
      ];

      aiButtonsEl.innerHTML = prompts.map(p => `
        <button type="button" class="btn-ask-ai-copy ch-ai-prompt-btn" data-prompt="${encodeURIComponent(p.prompt)}">
          <span>${p.icon}</span>
          <span>${p.label}</span>
        </button>
      `).join("");
    }

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeChapterSummaryModal() {
    const modal = document.getElementById("chapter-summary-modal");
    if (modal) {
      modal.classList.add("hidden");
      document.body.style.overflow = "";
    }
  }

  // Click listeners for modal
  document.addEventListener("click", function(e) {
    const trigger = e.target.closest("[data-open-chapter-summary]");
    if (trigger) {
      const chId = trigger.getAttribute("data-open-chapter-summary");
      openChapterSummaryModal(chId);
      return;
    }

    if (e.target.closest("[data-close-summary-modal]") || (e.target.id === "chapter-summary-modal")) {
      closeChapterSummaryModal();
      return;
    }

    // Click on concept pill badge -> scroll to detailed lesson notes in modal
    const pillBtn = e.target.closest(".ch-pill-badge");
    if (pillBtn) {
      const targetNoteId = pillBtn.getAttribute("data-concept-target");
      if (targetNoteId) {
        const noteCard = document.getElementById(targetNoteId);
        if (noteCard) {
          if (noteCard.tagName === "DETAILS") noteCard.open = true;
          noteCard.scrollIntoView({ behavior: "smooth", block: "center" });
          noteCard.classList.remove("highlight-card");
          void noteCard.offsetWidth;
          noteCard.classList.add("highlight-card");
          setTimeout(() => noteCard.classList.remove("highlight-card"), 2200);

          document.querySelectorAll(".ch-pill-badge").forEach(b => b.classList.remove("is-active"));
          pillBtn.classList.add("is-active");
        }
      }
      return;
    }

    // Jump to lesson card on page
    const jumpLessonBtn = e.target.closest(".ch-btn-jump-lesson");
    if (jumpLessonBtn) {
      const vidId = jumpLessonBtn.getAttribute("data-jump-video-id");
      const secSlug = jumpLessonBtn.getAttribute("data-section-slug");
      closeChapterSummaryModal();

      const currentPath = window.location.pathname;
      if (currentPath.includes(secSlug)) {
        handleSidebarNavigation("video-" + vidId);
        try { history.pushState(null, "", "#video-" + vidId); } catch(err) {}
        const videoCard = document.getElementById("video-" + vidId);
        if (videoCard) {
          const details = videoCard.querySelector(".video-notes-details");
          if (details) details.open = true;
        }
      } else {
        const metaBase = document.querySelector('meta[name="base-url"]')?.getAttribute('content');
        const base = metaBase ? (metaBase.endsWith('/') ? metaBase : metaBase + '/') : (window.location.pathname.startsWith('/nodejs') ? '/nodejs/' : '/');
        window.location.href = `${base}sections/${secSlug}/#video-${vidId}`;
      }
      return;
    }

    // Copy code snippet in lesson note card
    const copyLessonCodeBtn = e.target.closest(".btn-copy-lesson-code");
    if (copyLessonCodeBtn) {
      const codeText = decodeURIComponent(copyLessonCodeBtn.getAttribute("data-code"));
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(codeText).then(() => {
          const orig = copyLessonCodeBtn.textContent;
          copyLessonCodeBtn.textContent = "Copied ✓";
          setTimeout(() => { copyLessonCodeBtn.textContent = orig; }, 1800);
        });
      }
      return;
    }

    const aiCopyBtn = e.target.closest(".btn-ask-ai-copy");
    if (aiCopyBtn) {
      const promptText = decodeURIComponent(aiCopyBtn.getAttribute("data-prompt"));
      const showFeedback = () => {
        const originalText = aiCopyBtn.innerHTML;
        aiCopyBtn.classList.add("is-copied");
        aiCopyBtn.innerHTML = "<span>✓</span><span>Copied!</span>";
        setTimeout(() => {
          aiCopyBtn.classList.remove("is-copied");
          aiCopyBtn.innerHTML = originalText;
        }, 2000);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(promptText).then(showFeedback).catch(() => {
          const ta = document.createElement("textarea");
          ta.value = promptText;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch(err) {}
          document.body.removeChild(ta);
          showFeedback();
        });
      } else {
        const ta = document.createElement("textarea");
        ta.value = promptText;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch(err) {}
        document.body.removeChild(ta);
        showFeedback();
      }
      return;
    }
  });

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      closeChapterSummaryModal();
    }
  });
