import { html, $, on } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { empty } from '../ui.js';
import { tournamentCard, matchLine, statTiles, leaderRow } from '../cards.js';
import { mountHero } from '../hero.js';
import { setQuery } from '../router.js';

export default {
    title: 'Fling Things and People tournaments',
    load: () => get('/home'),

    render(d, ctx) {
        const me = store.me;
        const board = ctx.query.board === 'duo' ? 'duo' : 'solo';
        return html`<div class="home">
        <section class="hero" data-keep="hero">
            <canvas class="hero-canvas" aria-label="Interactive ragdolls you can grab and fling"></canvas>
            <div class="wrap hero-inner">
                <div class="hero-copy">
                    <span class="hero-badge">${icon('bolt')} Competitive Fling Things and People</span>
                    <h1 class="display">Grab.<br>Fling.<br><span>Win.</span></h1>
                    <p class="lead">Solo and duo tournaments for FTAP on Roblox. Check in to your match room, fight it out, and a referee counts every fling. Climb the ladder, earn your rank, take the crown.</p>
                    <div class="row wrap-ok hero-cta">
                        <a class="btn primary xl" href="/tournaments">${icon('trophy')}Find a tournament</a>
                        ${me ? html`<a class="btn xl outline" href="/u/${encodeURIComponent(me.username)}">${icon('user')}My profile</a>`
                            : html`<a class="btn xl outline" href="/register">Create account</a>`}
                    </div>
                    ${statTiles(d.stats)}
                </div>
            </div>
            <div class="fling-counter"><span>Flings</span><b class="display" data-flings>0</b></div>
            <div class="hero-hint">${icon('grab')}<span>Grab a noob and throw it</span></div>
        </section>

        ${d.live.length ? html`<section class="wrap home-sec">
            <div class="section-title"><span class="status live">Live now</span><span class="spacer"></span></div>
            <div class="m-lines">${d.live.map(m => matchLine(m))}</div>
        </section>` : ''}

        <section class="wrap home-sec">
            <div class="section-title">Upcoming tournaments<span class="spacer"></span><a class="more" href="/tournaments">See all →</a></div>
            ${d.upcoming.length ? html`<div class="grid grid-3">${d.upcoming.map(tournamentCard)}</div>`
                : html`<div class="card">${empty('calendar', 'No tournaments scheduled yet', 'New brackets are announced here — check back soon.', store.isAdmin() ? html`<a class="btn primary" href="/admin/tournaments/new">${icon('plus')}Create one</a>` : '')}</div>`}
        </section>

        <section class="wrap home-sec">
            <div class="section-title">How it works</div>
            <div class="steps">
                ${[
                    ['userPlus', 'Sign up & link Roblox', 'Make an account, verify your Roblox profile so refs know who you are in-game, and add your friends.'],
                    ['trophy', 'Enter solo or with a duo', 'Join 1v1 tournaments alone, or team up for 2v2. No partner? Enter a duo cup as a team of 1.'],
                    ['clock', 'Check in to your match room', "When your match is up you get a room with a chat. Check in on time — no-shows forfeit, and the log proves who was there."],
                    ['whistle', 'A ref scores the fight', 'A referee joins your server, watches every duel and records the kills. Wins move your Elo and ranking points.'],
                ].map(([ic, t, p], i) => html`<div class="step"><span class="step-n display">${i + 1}</span><span class="step-ico">${icon(ic)}</span><h3>${t}</h3><p>${p}</p></div>`)}
            </div>
        </section>

        <section class="wrap home-sec">
            <div class="grid grid-2 formats">
                <div class="card format-card solo">
                    <span class="chip pink">${icon('user')}Solo 1v1</span>
                    <h2 class="display">Best of three.<br>First to five kills.</h2>
                    <p class="dim">Two players, one server. Each duel is first to 5 flings (configurable). Win two duels to take the match — finals go longer.</p>
                    <div class="duel-demo">
                        <div class="dd-player a"><span class="av md" style="--c:#4d8dff">A</span></div>
                        <div class="dd-dots">${[1, 1, 0].map((w, i) => html`<i class="${w ? 'won' : ''}" title="Duel ${i + 1}"></i>`)}</div>
                        <div class="dd-player b"><span class="av md" style="--c:#ff4d8d">B</span></div>
                    </div>
                </div>
                <div class="card format-card duo">
                    <span class="chip blue">${icon('users')}Duo 2v2</span>
                    <h2 class="display">Two duels.<br>One decider.</h2>
                    <p class="dim">A 2v2 brawl gets messy, so duos play two 1v1s: best vs best, second vs second. At 1–1 the system randomly picks two players who haven't fought yet for a final decider.</p>
                    <div class="duo-diagram">
                        <div class="dd-team"><span class="pl a">A1</span><span class="pl a">A2</span></div>
                        <div class="dd-lines"><span><b>Duel 1</b></span><span><b>Duel 2</b></span></div>
                        <div class="dd-team"><span class="pl b">B1</span><span class="pl b">B2</span></div>
                        <div class="dd-decider">${icon('dice')}1–1? Decider: <b>A1 vs B2</b> or <b>A2 vs B1</b></div>
                    </div>
                    <a class="more-link" href="/rules#duo">Teams of 1 & scoring →</a>
                </div>
            </div>
        </section>

        <section class="wrap home-sec">
            <div class="grid grid-2">
                <div class="card">
                    <div class="card-head"><h3>Top players</h3><span class="spacer"></span>
                        <div class="seg" data-board>
                            <button class="${board === 'solo' ? 'on' : ''}" data-v="solo">Solo</button>
                            <button class="${board === 'duo' ? 'on' : ''}" data-v="duo">Duo</button>
                        </div>
                    </div>
                    ${d.top[board].length ? html`<div class="list">${d.top[board].map(leaderRow)}</div>`
                        : empty('chart', 'No ranked players yet', 'Play a match to get on the board.')}
                    <a class="btn ghost block" style="margin-top:10px" href="/leaderboard?mode=${board}">Full leaderboard ${icon('arrowRight')}</a>
                </div>
                <div class="card">
                    <div class="card-head"><h3>Recent results</h3></div>
                    ${d.recent.length ? html`<div class="m-lines compact">${d.recent.slice(0, 5).map(m => matchLine(m))}</div>`
                        : empty('swords', 'No matches played yet', 'Results appear here the moment a referee records them.')}
                </div>
            </div>
        </section>

        ${d.champions.length ? html`<section class="wrap home-sec">
            <div class="section-title">Hall of champions</div>
            <div class="grid grid-4">${d.champions.map(t => html`<a class="card link champ-card" href="/t/${t.id}" style="--ta:${t.accent}">
                ${icon('crown', 'crown')}
                <b class="display">${t.champion.name}</b>
                <span class="dim ellipsis">${t.name}</span>
            </a>`)}</div>
        </section>` : ''}

        <section class="wrap home-sec">
            <div class="cta-band">
                <div>
                    <span class="eyebrow">Fair play, enforced</span>
                    <h2 class="display">Every match has a ref.<br>Every check-in is on the record.</h2>
                    <p class="dim">No more "I showed up but they didn't answer". Match rooms log check-ins with timestamps, the chat can't be edited or deleted, and no-shows forfeit automatically.</p>
                </div>
                <div class="row wrap-ok">
                    <a class="btn primary lg" href="${me ? '/tournaments' : '/register'}">${me ? 'Enter a tournament' : 'Join the arena'}</a>
                    <a class="btn lg" href="/rules">Read the rules</a>
                </div>
            </div>
        </section>
        </div>`;
    },

    mount(root, d, ctx, { first }) {
        let stopHero = null;
        const heroEl = $('.hero', root);
        if (!heroEl._hero) {
            const counter = $('[data-flings]', heroEl);
            heroEl._hero = mountHero($('.hero-canvas', heroEl), {
                hint: $('.hero-hint', heroEl),
                onFling: n => {
                    counter.textContent = n;
                    counter.classList.remove('bump');
                    void counter.offsetWidth;
                    counter.classList.add('bump');
                },
            });
        }
        stopHero = heroEl._hero;
        if (!first) $('.hero-stats', heroEl).outerHTML = String(statTiles(d.stats));
        const offs = [
            on(root, 'click', '[data-board] button', (e, b) => {
                setQuery('board', b.dataset.v);
                ctx.query.board = b.dataset.v;
                ctx.reload();
            }),
        ];
        ctx.listen('match', () => ctx.reload());
        ctx.listen('tournament', () => ctx.reload());
        return ({ leaving }) => {
            offs.forEach(f => f());
            // The hero survives live re-renders (data-keep) but not navigation.
            if (leaving && stopHero) { stopHero(); heroEl._hero = null; }
        };
    },
};
