import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // Git worktrees live inside the repo (.worktrees/, .claude/worktrees/), so
    // the default glob picks up a whole extra copy of the suite per worktree.
    // Those copies belong to another branch, and running them alongside this
    // checkout's makes duplicate suites contend for the same fake-browser and
    // module state, so they fail spuriously. Spread the defaults rather than
    // replacing them — this key overrides node_modules/dist/.git otherwise.
    exclude: [...configDefaults.exclude, '**/.worktrees/**', '**/.claude/worktrees/**'],
  },
});
