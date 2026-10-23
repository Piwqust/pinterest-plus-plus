# Отправка в Chrome Web Store

Всё, что можно подготовить без аккаунта Google, уже лежит в репозитории. Ниже — шаги, которые может сделать только владелец аккаунта.

ZIP: `.output/pinterest-plus-plus-1.0.10-chrome.zip` после `npm run zip`.  
Тексты: `store/LISTING.md`.  
Картинки: `store/assets/`.  
Политика: https://piwqust.github.io/pinterest-plus-plus/ (`store/privacy.html`, копия в `docs/index.html`).

## Обновление уже опубликованного расширения

Если item уже есть в дашборде, шаги 1–2 и 4 не нужны.

Что изменилось с 1.0.8:

- **1.0.9:** скачивание видео идёт по данным пина из Pinterest и при необходимости собирает файл из HLS-потока локально; панель над пином больше не мигает; в попапе появилась настройка «Pin buttons» (на картинке или рядом с ⋯).
- **1.0.10:** новый знак (графитовая клавиша с белым «++») и вся графика листинга; политика и обоснования в листинге называют обе настройки, которые хранит расширение: ширину плитки и место кнопок.

Разрешения не менялись; в манифесте изменились только версия и иконки.

1. `npm test`, `npm run typecheck`, `npm run zip`.
2. **Политика конфиденциальности — до Submit.** С 1.0.8 изменились два раздела: «Website content, on your action» (расширение спрашивает у `pinterest.com` список медиа пина и может собрать видео из потока внутри Chrome) и «Settings stored in Chrome» (две настройки вместо одной). GitHub Pages публикует сайт из `docs/` ветки `master`, поэтому новый текст появится только после того, как эта ветка попадёт в `master` на GitHub. Проверьте https://piwqust.github.io/pinterest-plus-plus/ в инкогнито: должны быть «Effective date: 23 October 2026», «For Download it first asks pinterest.com…» и «The extension stores two settings…».
3. Dashboard → ваш item → **Package** → **Upload new package** → `.output/pinterest-plus-plus-1.0.10-chrome.zip`. Версия в манифесте должна быть выше опубликованной.
4. **Store listing**: замените подробное описание английским блоком из `LISTING.md` (добавлена фраза про размещение кнопок рядом с ⋯). Графика обновлена целиком, поэтому замените всё из `store/assets/`:
   - **иконку** `icon-128.png` (новый знак: графитовая клавиша с белым «++»; она же в пакете расширения);
   - **все пять скриншотов**: удалите старые и загрузите по порядку `screenshot-1-copy-download.png`, `screenshot-2-videos.png`, `screenshot-3-placement.png`, `screenshot-4-grid-slider.png`, `screenshot-5-copy.png`;
   - **обе промо-плитки**: `promo-small-440x280.png` и `promo-marquee-1400x560.png`.
5. **Privacy practices**: разрешения те же, но тексты из `LISTING.md` надо вставить заново:
   - **single purpose** (упоминает настройку места кнопок);
   - **`storage`** (две настройки: `tileWidth` и `buttonPlacement`);
   - **`offscreen`** (сборка видео из потока);
   - **host permission `pinterest.com`** (запрос списка медиа пина);
   - **test instructions**, если заполняли.
   
   Data use не меняется: только **Website content**.
6. **Submit for review**.

## 1. Аккаунт разработчика

1. Откройте [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Войдите в Google-аккаунт, который будет издателем.
3. Один раз оплатите регистрационный сбор разработчика (5 USD), если его ещё нет.
4. Заполните профиль издателя (имя, email). Trader / non-trader — по вашей ситуации; для бесплатного расширения обычно non-trader.

Это нельзя сделать из репозитория.

## 2. Публичный URL политики конфиденциальности

Уже опубликован:

```
https://piwqust.github.io/pinterest-plus-plus/
```

Вставьте эту ссылку в Privacy practices. Страница должна открываться в инкогнито. Исходник — `store/privacy.html`; GitHub Pages отдаёт копию из `docs/index.html`.

## 3. Сборка ZIP

Из корня репозитория:

```text
npm test
npm run typecheck
npm run zip
```

Загружайте `.output/pinterest-plus-plus-1.0.10-chrome.zip`. Это production MV3-пакет, не исходники.

## 4. New item

1. Dashboard → **New item**.
2. Загрузите ZIP.
3. Дождитесь разбора манифеста. Имя, краткое описание и иконки подтянутся из него.

## 5. Store listing

Вкладка **Store listing**. Вставьте поля из `LISTING.md` (английский блок).

Загрузите из `store/assets/`:

1. `icon-128.png`
2. скриншоты 1–5 по порядку
3. `promo-small-440x280.png`
4. `promo-marquee-1400x560.png`

YouTube можно пропустить. Категория: **Productivity**. Mature: нет.

## 6. Privacy practices

Вкладка **Privacy practices**. Вставьте single purpose и обоснования разрешений из `LISTING.md`.

- Remote code: **No**
- Data use: только **Website content**
- Limited Use: отметьте все подтверждения
- Privacy policy URL: ссылка из шага 2

## 7. Distribution

Public, Free, все регионы.

## 8. Submit

**Submit for review**. Первая проверка обычно занимает несколько дней. Типичные вопросы ревьюеров закрыты в `LISTING.md` (зачем MAIN-world script, зачем `offscreen`, зачем host permissions).

Если отклонят по торговой марке «Pinterest» в названии — не переименовывайте вслепую: сначала прочитайте письмо. В описании уже есть дисклеймер о независимости.

## Что здесь нельзя сделать за вас

- войти в ваш Google-аккаунт
- оплатить сбор 5 USD
- нажать Submit
