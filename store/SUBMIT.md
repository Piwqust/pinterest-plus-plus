# Отправка в Chrome Web Store

Всё, что можно подготовить без аккаунта Google, уже лежит в репозитории. Ниже — шаги, которые может сделать только владелец аккаунта.

ZIP: `.output/pinterest-plus-plus-1.1.0-chrome.zip` после `npm run zip`.  
Тексты: `store/LISTING.md`.  
Картинки: `store/assets/`.  
Политика: https://piwqust.github.io/pinterest-plus-plus/ (`store/privacy.html`, копия в `docs/index.html`).

## Обновление уже опубликованного расширения

Если item уже есть в дашборде, шаги 1–2 и 4 не нужны.

Что изменилось с 1.0.8:

- **1.0.9:** скачивание видео идёт по данным пина из Pinterest и при необходимости собирает файл из HLS-потока локально; панель над пином больше не мигает; в попапе появилась настройка «Pin buttons» (на картинке или рядом с ⋯).
- **1.0.10:** новый знак (графитовая клавиша с белым «++») и вся графика листинга; политика и обоснования в листинге называют обе настройки, которые хранит расширение: ширину плитки и место кнопок.
- **1.0.11:** попап в стиле нового знака: тёмный графит, белый свет, шрифт Inter внутри пакета; скриншот 3 показывает новую карточку «Pin buttons».
- **1.1.0:** коллекция. Третья кнопка на пине (закладка), панель «Collection» с автоскроллом ленты на 50/100/250 пинов, папками, фильтрами по типу, форме и цвету и сохранением одним ZIP (с `sources.csv`) или отдельными файлами. Коллекция хранится в `chrome.storage.local` на устройстве. В попапе вместо «On Pinterest» — карточка «Collection».

Разрешения не менялись. В манифесте изменились версия и `description` (теперь упоминает коллекцию и ZIP), в 1.0.11 добавился шрифт `fonts/inter-latin.woff2`, сетевых запросов он не добавляет. Обоснования `downloads`, `offscreen`, `storage` и обоих host permissions переписаны под коллекцию, их надо вставить заново.

1. `npm test`, `npm run typecheck`, `npm run zip`.
2. **Политика конфиденциальности — до Submit.** В 1.1.0 добавлен раздел «Your collection, on your action», а «Settings stored in Chrome» стал «What is stored in Chrome»: настройки в Sync и коллекция в `chrome.storage.local`. GitHub Pages публикует сайт из `docs/` ветки `master`, поэтому новый текст появится только после того, как эта ветка попадёт в `master` на GitHub. Проверьте https://piwqust.github.io/pinterest-plus-plus/ в инкогнито: должны быть «Effective date: 24 October 2026», «Your collection, on your action» и «Your collection, using chrome.storage.local…».
3. Dashboard → ваш item → **Package** → **Upload new package** → `.output/pinterest-plus-plus-1.1.0-chrome.zip`. Версия в манифесте должна быть выше опубликованной.
4. **Store listing**: замените подробное описание английским блоком из `LISTING.md` (в 1.1.0 добавлен абзац про коллекцию; summary берётся из манифеста). В 1.1.0 перерисованы все скриншоты и обе промо-плитки, иконка прежняя. Замените из `store/assets/`:
   - **иконку** `icon-128.png`, только если в дашборде ещё старая (до 1.0.10);
   - **все пять скриншотов**: удалите старые и загрузите по порядку `screenshot-1-copy-download.png`, `screenshot-2-collection.png`, `screenshot-3-scan-filter.png`, `screenshot-4-videos.png`, `screenshot-5-grid-slider.png`. Кадры с выбором места кнопок и с копированием в PNG ушли, их место заняли коллекция и скан с фильтром;
   - **обе промо-плитки**: `promo-small-440x280.png` и `promo-marquee-1400x560.png`.
5. **Privacy practices**: разрешения те же, но тексты из `LISTING.md` надо вставить заново:
   - **single purpose** (упоминает коллекцию);
   - **`storage`** (настройки в Sync и коллекция в `chrome.storage.local`);
   - **`downloads`** (пакетное сохранение файлами или ZIP);
   - **`offscreen`** (сборка видео из потока и упаковка ZIP);
   - **host permission `pinterest.com`** (кнопка сбора и скан страницы);
   - **host permission `pinimg.com`** (превью для фильтра по цвету);
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

Загружайте `.output/pinterest-plus-plus-1.1.0-chrome.zip`. Это production MV3-пакет, не исходники.

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
