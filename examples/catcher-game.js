// A tiny reference game written against the Anchor libs (also the fixture for the lib tests / bot demo).
// A ball falls; the player's paddle (locked to Input.getX()) must catch 15 of them before missing 3.
export function createCatcher({ input, rng, loop }, { width = 360, height = 640, goal = 15, lives = 3, speed = 260 } = {}) {
  const s = { ball: { x: width / 2, y: 0 }, caught: 0, lives, t: 0, won: false, minLives: lives };
  const drop = () => { s.ball.x = 20 + rng() * (width - 40); s.ball.y = 0; };
  drop();
  return {
    update(dt) {
      s.t += dt; s.ball.y += speed * dt;
      if (s.ball.y >= height - 40) {
        if (Math.abs(s.ball.x - input.getX()) <= 36) s.caught++; else { s.lives--; s.minLives = Math.min(s.minLives, s.lives); }
        drop();
        if (s.caught >= goal) { s.won = true; loop.gameOver(); } else if (s.lives <= 0) loop.gameOver();
      }
    },
    draw(ctx) { ctx.fillStyle = '#4db3ff'; ctx.fillRect(input.getX() - 36, height - 40, 72, 10); ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, 8, 0, 6.283); ctx.fill(); },
    observe: () => ({ ball: { ...s.ball }, caught: s.caught, lives: s.lives }),
    outcome: () => (s.won ? 'win' : 'lose'),
    stats: () => ({ caught: s.caught, minLives: s.minLives }),
  };
}
