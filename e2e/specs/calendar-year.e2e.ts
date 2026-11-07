import { $, $$, browser, expect } from '@wdio/globals';

// The calendar's Year view in a real browser (PL-093). The unit tests cover what it says and does;
// these are what only a layout engine and real key presses can show: a year that fills the pane
// and scrolls on into the next, shades that really are drawn, and the keyboard walk. XPath and CSS
// only, as in smoke.e2e.ts.

const modes = "[role='group'][aria-label='Calendar view']";
const dayFor = (date: string) => `[data-year-day='${date}']`;

/** Add a task for today on the Today page, so one day of the year is busy. */
async function addTaskForToday(title: string) {
  await browser.url('/today');
  const input = $("//textarea[starts-with(@placeholder, 'Add task')][not(@aria-hidden)]");
  await input.click();
  await input.setValue(title);
  await browser.keys('Enter');
  await expect($(`//*[@aria-label='Open ${title}']`)).toBeExisting();
}

async function openYear() {
  await browser.url('/calendar');
  await $(`${modes} button[aria-label='Year']`).click();
  await expect($('.year-months')).toBeDisplayed();
}

/** Today's date as the page draws it, `YYYY-MM-DD`. */
async function today(): Promise<string> {
  return (await $('[data-year-day][data-today]').getAttribute('data-year-day'))!;
}

describe('the calendar year view', () => {
  it('fills the screen with a year, in four columns and three rows, and scrolls on', async () => {
    await openYear();
    const year = (await today()).slice(0, 4);
    const layout = await browser.execute(() => {
      const pane = document.querySelector<HTMLElement>('.year-months')!.parentElement!;
      const room = pane.getBoundingClientRect();
      const inView = [...document.querySelectorAll<HTMLElement>('[data-year-month]')].filter(
        (month) => {
          const box = month.getBoundingClientRect();
          return box.top >= room.top - 1 && box.bottom <= room.bottom + 1;
        },
      );
      const boxes = inView.map((month) => month.getBoundingClientRect());
      const distinct = (values: number[]) => new Set(values.map(Math.round)).size;
      return {
        months: inView.map((month) => month.dataset.yearMonth),
        columns: distinct(boxes.map((box) => box.left)),
        rows: distinct(boxes.map((box) => box.top)),
        lowest: Math.max(...boxes.map((box) => box.bottom)),
        viewport: window.innerHeight,
        scrolls: pane.scrollHeight > pane.clientHeight,
      };
    });
    await expect(layout.months).toHaveLength(12);
    await expect(layout.months[0]).toBe(`${year}-01`);
    await expect(layout.months[11]).toBe(`${year}-12`);
    await expect(layout.columns).toBe(4);
    await expect(layout.rows).toBe(3);
    await expect(layout.lowest).toBeLessThanOrEqual(layout.viewport);
    await expect(layout.scrolls).toBe(true);
  });

  it('scrolls from December into January of the next year and back, by the wheel', async () => {
    await openYear();
    const year = Number((await today()).slice(0, 4));
    const inView = (month: string) =>
      browser.execute((wanted) => {
        const element = document.querySelector(`[data-year-month='${wanted}']`);
        const pane = document.querySelector('.year-months')!.parentElement!;
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const room = pane.getBoundingClientRect();
        return box.top >= room.top - 1 && box.bottom <= room.bottom + 1;
      }, month);
    const titleSays = async (wanted: number) => (await $('h2').getText()).includes(String(wanted));
    const wheelUntil = async (done: () => Promise<boolean>, deltaY: number) => {
      const pane = await $('.year-months').parentElement();
      const at = await browser.execute((el) => {
        const box = el.getBoundingClientRect();
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      }, pane);
      for (let tries = 0; tries < 40 && !(await done()); tries++) {
        await browser
          .action('wheel')
          .scroll({ ...at, deltaX: 0, deltaY, duration: 50 })
          .perform();
        await browser.pause(60);
      }
      await expect(await done()).toBe(true);
    };

    // The title moves on once the new year's heading reaches the top, not when it first shows.
    await expect(await inView(`${year}-12`)).toBe(true);
    await wheelUntil(() => titleSays(year + 1), 150);
    const january = await browser.execute(
      (wanted) => {
        const box = document
          .querySelector(`[data-year-month='${wanted}']`)
          ?.getBoundingClientRect();
        const room = document.querySelector('.year-months')!.parentElement!.getBoundingClientRect();
        return { bottom: box?.bottom ?? null, roomTop: room.top };
      },
      `${year + 1}-01`,
    );
    // A wheel tick is a good part of a row, so January may be partly past the top by now.
    await expect(january.bottom).toBeGreaterThan(january.roomTop);
    await expect($(`//h3[normalize-space()='${year + 1}']`)).toBeExisting();
    await browser.waitUntil(async () => (await $$('[data-year-day][tabindex="0"]').length) === 1);

    await wheelUntil(() => titleSays(year), -150);
    await wheelUntil(() => inView(`${year}-12`), -150);
    await expect($('h2')).toHaveText(expect.stringContaining(String(year)));
  });

  describe('stays exactly where it is left', () => {
    const scrollTop = () =>
      browser.execute(() => document.querySelector('.year-months')!.parentElement!.scrollTop);
    const paneCenter = async () => {
      const pane = await $('.year-months').parentElement();
      return browser.execute((el) => {
        const box = el.getBoundingClientRect();
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      }, pane);
    };
    /** Wheel an odd distance, so it stops well away from any row's edge, and let it settle. */
    async function leaveItMidRow() {
      const at = await paneCenter();
      for (let tick = 0; tick < 3; tick++) {
        await browser
          .action('wheel')
          .scroll({ ...at, deltaX: 0, deltaY: 137, duration: 50 })
          .perform();
      }
      let last = -1;
      await browser.waitUntil(
        async () => {
          const now = await scrollTop();
          const still = now === last;
          last = now;
          return still;
        },
        { interval: 250 },
      );
      return last;
    }
    const near = async (where: number) =>
      expect(Math.abs((await scrollTop()) - where)).toBeLessThanOrEqual(1);
    /** The first day and the first month name wholly in view. */
    const firstInView = (selector: string) =>
      browser.execute((wanted) => {
        const room = document.querySelector('.year-months')!.parentElement!.getBoundingClientRect();
        const found = [...document.querySelectorAll<HTMLElement>(wanted)].find((each) => {
          const box = each.getBoundingClientRect();
          return box.top >= room.top && box.bottom <= room.bottom;
        })!;
        found.setAttribute('data-e2e-pick', '');
        return true;
      }, selector);
    const picked = () => $('[data-e2e-pick]');
    const drawn = (selector: string) =>
      browser.waitUntil(async () => (await $$(selector).length) > 0);
    const backToYear = async () => {
      await $(`${modes} button[aria-label='Year']`).click();
      await expect($('.year-months')).toBeDisplayed();
    };

    for (const [name, width, height] of [
      ['a large screen', 1400, 900],
      ['a phone', 412, 900],
    ] as const) {
      it(`on ${name}: no snapping, and back from a day or a month to the same place`, async () => {
        const size = await browser.getWindowSize();
        await browser.setWindowSize(width, height);
        try {
          await openYear();
          const left = await leaveItMidRow();
          await browser.pause(800);
          await expect(await scrollTop()).toBe(left);

          await firstInView('[data-year-day]');
          await picked().click();
          await drawn('[data-cal-slots]');
          await backToYear();
          await near(left);

          await firstInView('[data-year-open-month]');
          await picked().click();
          await drawn('[data-cal-day]');
          await backToYear();
          await near(left);
        } finally {
          await browser.setWindowSize(size.width, size.height);
        }
      });
    }

    it('stays put when new data arrives from another tab', async () => {
      await openYear();
      const date = await today();
      const left = await leaveItMidRow();
      const here = await browser.getWindowHandle();
      await browser.newWindow(new URL('/today', browser.options.baseUrl).href);
      const other = (await browser.getWindowHandles()).find((handle) => handle !== here)!;
      await browser.switchToWindow(other);
      const input = $("//textarea[starts-with(@placeholder, 'Add task')][not(@aria-hidden)]");
      await input.click();
      await input.setValue('From another tab');
      await browser.keys('Enter');
      await expect($("//*[@aria-label='Open From another tab']")).toBeExisting();
      await browser.pause(800);
      await browser.closeWindow();
      await browser.switchToWindow(here);
      // It really did arrive: today's shade has come.
      await expect($(dayFor(date))).toHaveAttribute('data-heat', expect.stringMatching(/^[123]$/));
      await expect(await scrollTop()).toBe(left);
    });

    it('opens afresh on this month, and only Today and the arrows jump', async () => {
      await openYear();
      const now = await today();
      const year = Number(now.slice(0, 4));
      const thisMonth = `[data-year-month='${now.slice(0, 7)}']`;
      const opened = await scrollTop();
      await leaveItMidRow();

      // A new visit starts over, with the year still the view it was on.
      await browser.url('/calendar');
      await expect($(thisMonth)).toBeDisplayed();
      await expect(await scrollTop()).toBe(opened);

      await leaveItMidRow();
      await $("button[aria-label='Next']").click();
      await expect($('h2')).toHaveText(expect.stringContaining(String(year + 1)));
      await expect($(`//h3[normalize-space()='${year + 1}']`)).toBeDisplayed();
      await $("button[aria-label='Go to today']").click();
      await expect($('h2')).toHaveText(expect.stringContaining(String(year)));
      await near(opened);

      // Today asked for while in another view counts too.
      await leaveItMidRow();
      await $(`${modes} button[aria-label='Days']`).click();
      await $("button[aria-label='Go to today']").click();
      await backToYear();
      await near(opened);
    });

    it('moves to where the arrows of Month or Days paged to', async () => {
      await openYear();
      const shown = (month: string) => $(`[data-year-month='${month}']`);

      let left = await leaveItMidRow();
      await firstInView('[data-year-open-month]');
      const month = (await picked().getAttribute('data-year-open-month'))!;
      await picked().click();
      await drawn('[data-cal-day]');
      await $("button[aria-label='Next']").click();
      await backToYear();
      const next = new Date(`${month}-01T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      await expect(shown(next.toISOString().slice(0, 7))).toBeDisplayed();
      await expect(await scrollTop()).not.toBe(left);

      left = await leaveItMidRow();
      await firstInView('[data-year-day]');
      await picked().click();
      await drawn('[data-cal-slots]');
      await $("button[aria-label='Next']").click();
      const day = await browser.execute(() =>
        document.querySelector('[data-cal-slots]')!.getAttribute('data-cal-slots')!,
      );
      await backToYear();
      await expect(shown(day.slice(0, 7))).toBeDisplayed();
      await expect(await scrollTop()).not.toBe(left);
    });
  });

  it('parts the years with the line Month draws between its rows', async () => {
    const rule = (selector: string) =>
      browser.execute((wanted) => {
        const style = getComputedStyle(document.querySelector(wanted)!);
        return [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor];
      }, selector);
    await openYear();
    const year = rule('.year-row[data-year-end]');
    const heading = await browser.execute(() => {
      const style = getComputedStyle(document.querySelector('.year-heading')!);
      return {
        font: [style.fontSize, style.fontWeight],
        background: style.backgroundColor,
        lines: [style.borderTopWidth, style.borderBottomWidth, style.borderRadius],
      };
    });
    const title = await browser.execute(() => {
      const style = getComputedStyle(document.querySelector('h2 button')!);
      return [style.fontSize, style.fontWeight];
    });
    const inYear = await year;
    await $(`${modes} button[aria-label='Month']`).click();
    await browser.waitUntil(async () => (await $$('.cal-day').length) > 0);
    await expect(inYear).toEqual(await rule('.cal-day'));
    // Its heading is the calendar's title in words, with no band, chip or card round it.
    await expect(heading.font).toEqual(title);
    await expect(heading.background).toBe('rgba(0, 0, 0, 0)');
    await expect(heading.lines).toEqual(['0px', '0px', '0px']);
  });

  it('never moves the page around it on a phone, with the bar along the bottom', async () => {
    const { width, height } = await browser.getWindowSize();
    await browser.setWindowSize(412, 900);
    try {
      await openYear();
      await expect($('.year-months')).toBeExisting();
      for (const mode of ['Year', 'Month']) {
        await $(`${modes} button[aria-label='${mode}']`).click();
        const page = await browser.execute(() => ({
          height: document.documentElement.scrollHeight,
          room: window.innerHeight,
        }));
        await expect(page.height).toBeLessThanOrEqual(page.room);
      }
    } finally {
      await browser.setWindowSize(width, height);
    }
  });

  it('shades a busy day, leaves a free one bare, and names each day for a pointer', async () => {
    await addTaskForToday('Year probe');
    await openYear();
    const date = await today();
    const busy = $(dayFor(date));
    await expect(busy).toHaveAttribute('data-heat', expect.stringMatching(/^[123]$/));
    await expect(busy).toHaveAttribute(
      'title',
      expect.stringMatching(/^Today, .+, \d+ open tasks?$/),
    );
    // The shade is painted, and the number on it is not the same color as it.
    const colors = await browser.execute((selector) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return { background: style.backgroundColor, text: style.color };
    }, dayFor(date));
    await expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    await expect(colors.background).not.toBe(colors.text);

    const free = $$('[data-year-day][data-heat="0"]')[0]!;
    await expect(free).toHaveAttribute('title', expect.stringMatching(/no open tasks$/));
    const bare = await browser.execute((el) => getComputedStyle(el).backgroundColor, await free);
    await expect(bare).toBe('rgba(0, 0, 0, 0)');
    // The legend runs from free to busy.
    await expect($("//*[normalize-space()='Free']")).toBeDisplayed();
    await expect($("//*[normalize-space()='Busy']")).toBeDisplayed();
  });

  it('opens a day in Days and a month by its name', async () => {
    await openYear();
    const year = (await today()).slice(0, 4);
    await $(dayFor(`${year}-03-10`)).click();
    await expect($(`[data-cal-slots='${year}-03-10']`)).toBeDisplayed();

    await openYear();
    await $("button[aria-label='Open March']").click();
    await expect($(`[data-cal-day='${year}-03-01']`)).toBeDisplayed();
  });

  it('pages by a year, comes back to this one, and takes the paged year to Month', async () => {
    await openYear();
    const now = await today();
    const year = Number(now.slice(0, 4));
    await expect($('h2')).toHaveText(expect.stringContaining(String(year)));
    await $("button[aria-label='Next']").click();
    await expect($('h2')).toHaveText(expect.stringContaining(String(year + 1)));
    await expect($(dayFor(`${year + 1}-01-01`))).toBeDisplayed();
    await $("button[aria-label='Go to today']").click();
    await expect($('h2')).toHaveText(expect.stringContaining(String(year)));
    await $("button[aria-label='Previous']").click();
    await $(`${modes} button[aria-label='Month']`).click();
    await expect($(`[data-cal-day='${year - 1}-${now.slice(5)}']`)).toBeDisplayed();
  });

  it('walks the days with the arrow keys and opens one with Enter', async () => {
    await openYear();
    const year = (await today()).slice(0, 4);
    await expect($$('[data-year-day][tabindex="0"]')).toBeElementsArrayOfSize(1);
    await browser.execute(
      (selector) => document.querySelector<HTMLElement>(selector)!.focus(),
      dayFor(`${year}-06-15`),
    );
    await browser.keys(['ArrowRight', 'ArrowDown']);
    const focused = await browser.execute(
      () => document.activeElement?.getAttribute('data-year-day') ?? null,
    );
    // 15 June, a day on, a week down: 23 June (the arrows follow the dates, not the grid).
    await expect(focused).toBe(`${year}-06-23`);
    await expect($$('[data-year-day][tabindex="0"]')).toBeElementsArrayOfSize(1);
    await browser.keys('Enter');
    await expect($(`[data-cal-slots='${year}-06-23']`)).toBeDisplayed();
  });

  it('sets Unscheduled aside in Year and brings it back in Month', async () => {
    await browser.url('/calendar');
    await $("button[aria-label='Unscheduled']").click();
    await expect($("[role='list'][aria-label='Unscheduled']")).toBeDisplayed();
    await $(`${modes} button[aria-label='Year']`).click();
    await expect($("[role='list'][aria-label='Unscheduled']")).not.toBeExisting();
    await expect($("button[aria-label='Unscheduled']")).not.toBeExisting();
    await $(`${modes} button[aria-label='Month']`).click();
    await expect($("[role='list'][aria-label='Unscheduled']")).toBeDisplayed();
  });

  it('stays in Year after a reload', async () => {
    await openYear();
    await browser.refresh();
    await expect($('.year-months')).toBeDisplayed();
  });
});
