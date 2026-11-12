// The Chat page's tabs, built from this list: tab -> [[box title, [[kind, field, options]...]]...].
// kind: toggle | range | seg | select | color | text | number. options.only: shown only when renderChat()'s show[only] is true.
const CHAT_TABS = () => ({
  text: [
    [
      'chatText',
      [
        ['select', 'font', { options: chatFonts.map((x) => [x, x]) }],
        ['range', 'fontSize', { min: 10, max: 72, label: 'messageSize' }],
        ['color', 'textColor', { label: 'messageColor' }],
        ['toggle', 'textShadow'],
        [
          'select',
          'textDir',
          {
            options: [
              ['auto', 'dirAuto'],
              ['ltr', 'dirLtr'],
              ['rtl', 'dirRtl'],
            ],
          },
        ],
        ['toggle', 'showTime'],
        ['toggle', 'showColon'],
        [
          'select',
          'replies',
          {
            options: [
              ['line', 'repliesLine'],
              ['name', 'repliesName'],
              ['quote', 'repliesQuote'],
              ['off', 'repliesOff'],
            ],
          },
        ],
      ],
    ],
    [
      'chatEmotes',
      [
        ['toggle', 'emotesKick'],
        ['toggle', 'emotesTwitch'],
        ['toggle', 'emotes7tv'],
        ['toggle', 'emotesAnimated'],
        ['range', 'emoteSize', { min: 12, max: 112 }],
        ['toggle', 'bigEmotes'],
        ['range', 'bigEmoteSize', { min: 16, max: 160, only: 'big' }],
      ],
    ],
  ],
  names: [
    [
      'nameBox',
      [
        ['range', 'nameSize', { min: 10, max: 72 }],
        [
          'seg',
          'nameColorMode',
          {
            label: 'nameColor',
            options: [
              ['user', 'nameOwn'],
              ['style', 'nameStyle'],
              ['custom', 'nameCustom'],
            ],
          },
        ],
        ['color', 'nameColor', { only: 'nameCustom' }],
        ['toggle', 'readableNames', { only: 'nameOwn' }],
        [
          'seg',
          'namePos',
          {
            options: [
              ['inline', 'nameInline'],
              ['above', 'nameAbove'],
            ],
          },
        ],
        ['toggle', 'showPlatform'],
        ['toggle', 'avatars', { hint: 'avatarsHint' }],
        ['toggle', 'fxRainbowVip'],
        ['text', 'rainbowUsers', { hint: 'listHint' }],
      ],
    ],
    [
      'badgeBox',
      [
        ['toggle', 'showBadges'],
        [
          'seg',
          'badgeMode',
          {
            options: [
              ['important', 'badgesImportant'],
              ['all', 'badgesAll'],
            ],
            only: 'badges',
          },
        ],
        ['range', 'badgeSize', { min: 0.5, max: 2, step: 0.05, only: 'badges' }],
        [
          'seg',
          'badgeBg',
          {
            options: [
              ['auto', 'badgeBgAuto'],
              ['always', 'badgeBgAlways'],
              ['off', 'badgeBgOff'],
            ],
            only: 'badges',
          },
        ],
        ['toggle', 'badgeBroadcaster', { only: 'badges' }],
        ['toggle', 'badgeMod', { only: 'badges' }],
        ['toggle', 'badgeVip', { only: 'badges' }],
        ['toggle', 'badgeSub', { only: 'badges' }],
        ['toggle', 'badgeOther', { only: 'badges' }],
        ['toggle', 'ogHat'],
        [
          'seg',
          'hatStyle',
          {
            options: [
              ['cap', 'hatCap'],
              ['beanie', 'hatBeanie'],
              ['fedora', 'hatFedora'],
            ],
            only: 'hat',
          },
        ],
        [
          'select',
          'hatPos',
          {
            options: [
              ['first', 'hatFirst'],
              ['last', 'hatLast'],
              ['badge', 'hatBadge'],
              ['avatar', 'hatAvatar'],
            ],
            only: 'hat',
          },
        ],
      ],
    ],
  ],
  events: [
    [
      'eventLines',
      [
        ['toggle', 'eventKicks'],
        ['number', 'eventKicksMin', { only: 'evKicks' }],
        ['toggle', 'eventSubs'],
        ['toggle', 'eventGifts'],
        ['number', 'eventGiftsMin', { only: 'evGifts' }],
        ['toggle', 'eventBits'],
        ['number', 'eventBitsMin', { only: 'evBits' }],
        ['toggle', 'eventRaids'],
      ],
    ],
    [
      'eventLookBox',
      [
        [
          'seg',
          'eventLook',
          {
            options: [
              ['card', 'lookCard'],
              ['glow', 'lookGlow'],
              ['line', 'lookLine'],
            ],
          },
        ],
        ['toggle', 'eventLonger'],
      ],
    ],
    [
      'chatFx',
      [
        ['toggle', 'fxSubGlow'],
        ['toggle', 'fxFirst'],
        ['toggle', 'fxMention'],
        ['toggle', 'fxCombo'],
      ],
    ],
  ],
  filters: [
    [
      'chatFilters',
      [
        ['toggle', 'hideCommands'],
        ['toggle', 'hideBots'],
        ['text', 'bots', { only: 'bots', hint: 'listHint' }],
        ['text', 'hiddenUsers', { hint: 'listHint' }],
        ['text', 'blockedWords', { hint: 'listHint', dir: 'auto' }],
        ['toggle', 'hideLinks'],
        [
          'select',
          'source',
          {
            options: [
              ['both', 'sourceBoth'],
              ['kick', 'sourceKick'],
              ['twitch', 'sourceTwitch'],
            ],
          },
        ],
      ],
    ],
  ],
  layout: [
    [
      'chatBox',
      [
        [
          'seg',
          'bg',
          {
            label: 'bgMode',
            options: [
              ['color', 'bgColor'],
              ['transparent', 'bgTransparent'],
              ['off', 'bgOff'],
            ],
          },
        ],
        ['color', 'bgColor', { only: 'bgColor' }],
        ['range', 'bgOpacity', { min: 0, max: 1, step: 0.05, only: 'bgColor' }],
        ['toggle', 'bubbles', { label: 'bubblesOpt' }],
        ['toggle', 'border'],
        ['color', 'borderColor', { only: 'borderOn' }],
        [
          'seg',
          'borderColorMode',
          {
            options: [
              ['user', 'borderUser'],
              ['custom', 'borderCustom'],
            ],
            only: 'msgBorder',
          },
        ],
        ['range', 'borderWidth', { min: 1, max: 12, only: 'borderOn' }],
        ['range', 'radius', { min: 0, max: 40 }],
        ['range', 'padding', { min: 0, max: 60 }],
        ['range', 'gap', { min: 0, max: 40 }],
        ['range', 'width', { min: 200, max: 1920, step: 10, label: 'chatWidth' }],
        ['range', 'height', { min: 40, max: 1080, step: 10, label: 'chatHeight' }],
        ['range', 'blur', { min: 0, max: 40 }],
      ],
    ],
    [
      'chatMotion',
      [
        [
          'seg',
          'layout',
          {
            options: [
              ['vertical', 'layoutVertical'],
              ['horizontal', 'layoutHorizontal'],
            ],
          },
        ],
        [
          'seg',
          'tickerDir',
          {
            options: [
              ['rtl', 'dirRtlArrow'],
              ['ltr', 'dirLtrArrow'],
            ],
            only: 'ticker',
          },
        ],
        ['range', 'tickerSpeed', { min: 20, max: 600, step: 10, only: 'ticker' }],
        ['toggle', 'tickerLoop', { only: 'ticker' }],
        [
          'seg',
          'tickerPos',
          {
            options: [
              ['top', 'posTop'],
              ['bottom', 'posBottom'],
            ],
            only: 'ticker',
          },
        ],
        [
          'seg',
          'newAt',
          {
            options: [
              ['bottom', 'newBottom'],
              ['top', 'newTop'],
            ],
            only: 'vertical',
          },
        ],
        ['range', 'maxMessages', { min: 1, max: 100 }],
        ['range', 'hideAfter', { min: 0, max: 600, step: 5 }],
        [
          'select',
          'enterAnim',
          {
            options: [
              ['slide', 'animSlide'],
              ['fade', 'animFade'],
              ['pop', 'animPop'],
              ['float', 'animFloat'],
              ['bounce', 'animBounce'],
              ['drop', 'animDrop'],
              ['none', 'animNone'],
            ],
          },
        ],
        [
          'select',
          'exitAnim',
          {
            options: [
              ['fade', 'animFade'],
              ['slide', 'animSlide'],
              ['none', 'animNone'],
            ],
          },
        ],
        ['range', 'animSpeed', { min: 0.25, max: 3, step: 0.25 }],
        ['toggle', 'fade'],
        ['range', 'fadeZone', { min: 0, max: 400, step: 5, only: 'fade' }],
        ['toggle', 'typewriter'],
        ['toggle', 'typeSound', { only: 'typewriter' }],
      ],
    ],
    ['chatDebug', [['toggle', 'showTiming']]],
  ],
});
