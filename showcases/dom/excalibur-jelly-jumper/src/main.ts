import * as ex from 'excalibur'
import { loader } from './resources'
import Level1 from './scenes/level1'
import Demo from './scenes/demo'
import { GRAVITY } from './physics/gravity'
import { AudioManager } from './state/audio'

const game = new ex.Engine({
  resolution: {
    height: ex.Resolution.SNES.height,
    // make 16:9
    width: (ex.Resolution.SNES.height / 9) * 16,
  },
  displayMode: ex.DisplayMode.FitScreen,
  fixedUpdateFps: 60,
  // maxFps: 60,
  physics: {
    gravity: GRAVITY,
    solver: ex.SolverStrategy.Arcade,
    arcade: {
      contactSolveBias: ex.ContactSolveBias.VerticalFirst,
    },
    colliders: {
      compositeStrategy: 'separate',
    },
  },
  pixelRatio: 4, // 4x upscale the resolution, logs an incorrect warning
  pixelArt: true, // turn on pixel art sampler
  scenes: {
    root: {
      scene: Level1,
      transitions: {
        out: new ex.FadeInOut({
          duration: 300,
          direction: 'out',
        }),
        in: new ex.FadeInOut({ duration: 300, direction: 'in' }),
      },
    },
    demo: Demo,
  },
})
AudioManager.init();
// start game
game.start(loader).then(() => {
  game.screen.pixelRatioOverride = 4;
  game.screen.applyResolutionAndViewport();
});
