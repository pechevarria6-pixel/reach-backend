import { test } from 'node:test';
import assert from 'node:assert/strict';
import { climateVetoes, climateBreach, climateChecksOn } from '../../lib/climate.ts';
import { CLIMATE_CHECKS_ENABLED } from '../../lib/weather-no-go.ts';

// The owner's call for the beta: the weather is shown, the no-gos are not enforced.
test('with the switch off, a cold no-go is not asked, not checked and never breached', () => {
  assert.equal(CLIMATE_CHECKS_ENABLED, false);
  assert.equal(climateChecksOn(), false);
  assert.deepEqual(climateVetoes(['coldWeather', 'extreme heat']), { cold: false, heat: false });
  const januaryInAspen = { highC: -2, lowC: -15, when: 'January' } as never;
  const v = climateBreach(januaryInAspen, ['coldWeather']);
  assert.equal(v.veto, null);
  assert.equal(v.asked, false);
  assert.equal(v.checked, false);
});
