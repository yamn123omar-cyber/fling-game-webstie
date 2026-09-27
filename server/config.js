// Central tuning knobs. Everything that affects fairness lives here so it is easy
// to find, tweak, and explain on the public Rules page (served via /api/config).

module.exports = {
    // ── Rating (Elo) ────────────────────────────────────────────────────────
    rating: {
        start: 1000,
        kProvisional: 40,       // first `provisionalMatches` matches move faster
        provisionalMatches: 10,
        k: 32,
        kHigh: 24,              // calmer changes once you are at the top
        kHighThreshold: 1500,
        // Teams of 1 in duo tournaments: smaller gains, bigger losses.
        soloTeamWinMult: 0.75,
        soloTeamLossMult: 1.25,
        noShowPenalty: 10,      // flat Elo loss for not showing up
    },

    // ── Ranking points (RP) ─────────────────────────────────────────────────
    // Points only go up for normal teams — losing never costs RP.
    // Teams of 1 in duo tournaments earn less and do lose a little on a loss.
    points: {
        matchWin: 10,
        strengthMin: 0.5,       // beating a much weaker opponent: at least 50%
        strengthMax: 2,         // beating a much stronger opponent: up to 200%
        forfeitWin: 5,
        noShow: -10,
        soloTeamWinMult: 0.6,
        soloTeamLoss: -5,
        participation: 2,
        placement: { 1: 60, 2: 35, 3: 20, 4: 12, 8: 6 }, // key = "top N"
        placementSizeMin: 0.5,  // scaled by entrants / 8, clamped
        placementSizeMax: 2,
    },

    // ── Ranks shown next to Elo ─────────────────────────────────────────────
    tiers: [
        { name: 'Bronze', min: 0, color: '#c98b5a' },
        { name: 'Silver', min: 1050, color: '#b9c3d3' },
        { name: 'Gold', min: 1150, color: '#ffc94d' },
        { name: 'Platinum', min: 1250, color: '#5ee6d0' },
        { name: 'Diamond', min: 1350, color: '#7aa8ff' },
        { name: 'Champion', min: 1500, color: '#ff5ea8' },
    ],

    // ── Tournament defaults (admins can override per tournament) ────────────
    tournamentDefaults: {
        mode: 'solo',
        format: 'single',
        maxEntrants: 32,
        checkinMinutes: 30,      // tournament check-in opens this long before start
        matchPrepMinutes: 10,    // time between a match becoming ready and its start
        matchCheckinMinutes: 15, // match check-in opens this long before the match
        noShowGraceMinutes: 10,  // after the scheduled time, no-shows forfeit
        firstTo: 5,              // kills needed to win a single duel
        bestOf: 3,               // duels per solo match
        finalBestOf: 5,          // duels in the (grand) final of a solo tournament
        allowSoloTeams: true,
        requireRoblox: false,
        grandFinalReset: true,
        thirdPlaceMatch: false,
        drawRule: 'duels',       // 'duels' → 1-1 goes to decider; 'kills' → total kills first
    },

    chat: {
        maxLength: 500,
        historyPerChannel: 1000,
        matchHistory: 3000,
    },
};
