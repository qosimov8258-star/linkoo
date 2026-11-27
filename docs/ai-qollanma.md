<!--
Bu fayl Mezon AI yordamchisining tizim qo'llanmasi: u yordamchining system prompt'iga qo'shiladi (lib/bug-reports/manual.ts).
Fayl egasi uni qo'lda tahrirlab boradi: yangi holatlar, aniq javoblar va o'zgargan ekranlarni shu yerga qo'shing.
O'zgarish taxminan bir daqiqada kuchga kiradi (server qayta ishga tushirilmaydi).
Faqat tizimda haqiqatan bor narsani yozing: yordamchi shu matndan tashqariga chiqmasligi kerak.
-->

# Mezon — mijozlarga yordam qo'llanmasi

Mezon — distribyutsiya va savdo uchun ERP. Ekran tili rus, o'zbek, turkman yoki ingliz bo'lishi mumkin; quyida tugma va menyu nomlari rus tilida «...» ichida berilgan (til tanlansa, ular tarjima qilinib ko'rinadi). Til «Настройки» panelida (yuqori o'ngdagi tishli g'ildirak belgisi) almashtiriladi.

## 1. Umumiy qoidalar (avval shularni tekshiring)

### Rollar
- «Администратор» (admin) — hamma narsani ko'radi va o'zgartiradi, huquq cheklovlari unga ta'sir qilmaydi.
- «Менеджер» (manager) — ma'lumot kiritadi va o'zgartiradi. Unga «Права доступа» biriktirilgan bo'lsa, faqat ruxsat berilgan bo'limlarni o'zgartira oladi.
- «Только просмотр» (viewer) — barcha sahifalarni ochadi, lekin hech narsani saqlay, o'zgartira yoki o'chira olmaydi. Har qanday saqlash urinishi «У вас нет прав на это действие» xatosini beradi. Bu xato emas: administrator rolni o'zgartirishi kerak.
- Sahifalarning o'zi hammaga ochiladi; ma'lumotni server rol va huquqqa qarab beradi.

### «Права доступа» (huquq to'plami)
Foydalanuvchiga huquq to'plami biriktirilgan bo'lsa, o'zgartirish uchun tegishli «Возможности» kerak:
- Kassa amallari (приход, расход, перевод, «Групповая оплата») — kassa huquqi;
- «Оплаты от клиентов», «Оплаты поставщикам» — to'lovlar huquqi;
- Balanslar, zarplata, shartnomalar, kirim/chiqim kategoriyalari, «Организация» — moliya huquqi;
- Ombor: qoldiq, ko'chirish, hisobdan chiqarish, inventarizatsiya, omborlar — ombor huquqi;
- «Приход от поставщиков», «Возврат поставщиков», «Поставщики» — xarid huquqi;
- Buyurtmalar va mijoz qaytarishlari — buyurtma huquqi;
- Mijozlar, marshrutlar, vazifalar, so'rovnomalar — mijozlar huquqi;
- Mahsulotlar, xomashyo, «Прайс-листы», «Переоценка» — katalog huquqi;
- Filiallar, valyutalar, xodimlar, lavozimlar, kassalar, «Ограничение времени» — sozlamalar huquqi;
- Saqlangan hisobotlar va dashbordlar — hisobot huquqi.

Huquq bo'lmasa: ba'zi tugmalar umuman ko'rinmaydi (masalan «Групповая оплата», «Групповой приход»), qolganlarida saqlashda «У вас нет прав на это действие» yoki «Недостаточно прав» chiqadi. Huquq qo'shilsa, keyingi so'rovdan kuchga kiradi (qayta kirish shart emas).

Huquq to'plami bor foydalanuvchi uchun qo'shimcha o'qish cheklovlari:
- Kompaniya pullari («Управления кассой», kassa/xodim/filial balanslari, P&L, zarplata, xarajat hisobotlari) faqat moliya, kassa yoki hisobot huquqi bo'lsa ochiladi; aks holda sahifa ma'lumot yuklamaydi va xato ko'rsatadi.
- Xarid narxlari va tannarx («Приход от поставщиков», «Себестоимость», «Формирование цен») — xarid, ombor, ishlab chiqarish yoki katalog huquqi kerak.
- Agentlar dashboard va hisobotlarda faqat o'z ko'rsatkichlarini (o'zi va nazorat qiladigan agentlar) ko'radi.

«Права доступа» sahifasi va foydalanuvchilar ro'yxati bilan faqat administrator ishlaydi (boshqalarga ma'lumot yuklanmaydi).

### Filial tanlovi (eng ko'p uchraydigan sabab)
Yuqori o'ngdagi foydalanuvchi nomi ostida tanlangan filial yoziladi («Все филиалы» yoki filial nomi). Filial tanlansa, mijozlar, buyurtmalar, to'lovlar, kassalar, omborlar, xodimlar, postavkalar va dashboard faqat shu filial bo'yicha ko'rinadi. Mijoz «ma'lumotlar yo'qoldi» desa — avval akkaunt menyusidan «Все филиалы»ni tanlashni so'rang. Filial almashtirilganda dashboard qayta ochiladi.

### Filtrlar va sanalar
- Ro'yxat holati (filtrlar, qidiruv, sahifa, saralash) manzil satrida saqlanadi: havola qayta ochilganda eski filtr qoladi. Qo'llangan filtrlar ro'yxat tepasida ko'rinadi; «Очистить» bilan tozalanadi.
- «Аналитика» bosh sahifasi va ko'p hisobotlar bugungi sana bilan ochiladi. «Ma'lumot yo'q» bo'lsa, davrni kengaytiring («Текущий месяц», «Последние 7 дней», «Своя»).
- Sana filtri (yaratilgan sana, yetkazish sanasi) qatorlarni yashirishi mumkin.

### Tanlash maydonlari (select)
- Mijoz tanlash ro'yxati ochilganda eng yangi 50 ta mijozni ko'rsatadi. Kerakli mijoz ko'rinmasa — nomining bir qismini yozing, qidiruv qolganini topadi.
- Bo'sh ro'yxat ko'pincha ma'lumotnoma to'ldirilmaganini bildiradi (zona, mijoz turi, ombor, prays-list, organizatsiya). Ko'p formada «+добавить» / «+ добавить» havolasi bor — u yangi qiymat yaratish oynasini ochadi.
- Faol bo'lmagan ombor hujjatda ishlatilsa — «Склад неактивен».

### Valyuta va kurslar
- «Настройки» → «Валюта приложения» tanlangan bo'lsa, ro'yxatlarda faqat shu valyuta chiqadi va boshqa valyutadagi hujjat rad etiladi: «Валюта документа должна совпадать с валютой приложения».
- «Курс валюты не задан» / «Курс кассы не задан» — «Настройки» → «Валюты»da kursni o'rnatish kerak.
- «Округление сумм» — summalarning nechta kasr bilan ko'rsatilishi (saqlangach sahifa qayta yuklanadi).

### Kirish, parol, sessiya
- «Неверный логин или пароль» — login yoki parol noto'g'ri.
- «Доступ к системе отключен. Обратитесь к администратору.» — xodim kartasida «Доступ к системе» o'chirilgan yoki xodim o'chirilgan.
- «Слишком много попыток входа. Попробуйте позже.» — ko'p noto'g'ri urinish; biroz kuting.
- «Для продолжения работы задайте новый пароль.» — administrator parol qo'ygan yoki birinchi kirish: ochilgan oynada yangi parol o'rnating. Shu vaqtgacha ma'lumot yuklanmaydi.
- Parol talablari: oddiy akkaunt — kamida 8 belgi, faqat raqamdan iborat bo'lmasin, juda oddiy bo'lmasin («Пароль слишком простой»); xodim akkaunti — kamida 3 belgi (faqat raqam ham mumkin). Ikkalasida ham parol login bilan bir xil bo'lmasin.
- «Ваша сессия завершена. Войдите снова.» — sessiya tugatilgan («Сессия» sahifasida), parol yoki huquq o'zgargan. Qayta kiring.
- Parolni o'zi o'zgartirish: akkaunt menyusi → «Сменить пароль»; boshqa sessiyalar tugatiladi.

### Texnik xabarlar (xato emas)
- «Слишком много запросов. Подождите немного и повторите.» — juda ko'p so'rov; bir daqiqa kuting.
- «Слишком большой запрос» — bitta so'rov 2 MB dan katta (masalan, juda katta Excel). Faylni bir necha qismga bo'lib yuklang.
- «Данные сейчас изменяет другая операция, повторите попытку», «Сервер занят, повторите попытку» — qayta urinib ko'ring.
- «Сервер недоступен, попробуйте ещё раз» — internet yoki server aloqasi; takrorlansa, bu xato.
- «Удаление невозможно из-за связи с другими данными» — yozuvga boshqa hujjatlar bog'langan, uni o'chirib bo'lmaydi.

## 2. Menyu xaritasi
Yuqori menyu: «Аналитика», «Клиенты», «Продажи», «Персонал», «Склад», «Финансы», «Производство». Sozlamalar — tishli g'ildirak («Настройки»). Qo'ng'iroqcha — bildirishnomalar. Yulduzcha — «Добавить в избранные».
- «Продажи»: «Заказы», «Возвраты», «Отказы», «Фотоотчеты», «Perfect store», «Маркетинговые акции», «Бонусы клиентов», «Рассылка», «Опросник», «Смена».
- «Клиенты»: «Клиенты», «Классификация и динамика клиентов», «Финансовые счета», «Ограничения по клиентам», «Территория», «Маршруты», «Анализ дублей», «Типы клиентов», «Атрибуты».
- «Персонал»: «Филиалы», «Сотрудники», «Должности», «Права доступа», «KPI задачи», «Зарплата и установка планов», «Активность», «Отслеживание», «Посещения на работу», «Задачи», «Ограничение времени», «База знания», «Ограничение продуктов».
- «Склад»: «Приход от поставщиков», «Возврат поставщиков», «Поставщики», «Формирование цен», «Остаток», «Остаток на определенную дату», «Инвентаризация», «Передачи между складами», «Списание», «Склады», «Продукты», «Сырье», «Прайс-листы», «Переоценка», «Себестоимость».
- «Финансы»: «Управления кассой», «Оплаты от клиентов», «Оплаты поставщикам», «Баланс клиентов», «Баланс поставщиков», «Долги с заказов», «Долги по счетам», «Ожидаемые расходы», «Ожидаемые оплаты», «Договоры», «Сверка счетов», «Кассы», «Категории приходов», «Категории расходов».
- «Производство»: «Партии», «Этапы производства».

## 3. Modullar

### «Продажи» → «Заказы»
Mijoz buyurtmalari. Ochish: manager va admin (buyurtma huquqi bilan); viewer faqat ko'radi.

Ro'yxat yorliqlari: «Активные» (Не подтвержден, В процессе, Есть на складе), «Доставляется» (Передан доставщику), «Доставленные», «Все». Bekor qilingan buyurtmalar hech qaysi yorliqda chiqmaydi — «Фильтр» → «Дополнительно» → «Показать отмененные заказы» belgilanishi kerak.

Yangi buyurtma: «Добавить» →
1. «Дата создания», «Название клиента» (yangi mijoz: yonidagi «+ добавить»).
2. «Тип оплаты» («Наличные» / «Перечисление»), «Валюта», «Прайс лист», «Агент», «Организация» (organizatsiyalar bo'lsa), «Дата окончательной оплаты».
3. «Склад», «Тип доставки» («Доставка» bo'lsa «Доставщик» va «Дата доставки» chiqadi; «Самовывоз»da chiqmaydi).
4. Tovarlar: «добавить товар», «добавить из списка» yoki «импортировать c excel». Tovar qo'shish tugmalari ishlashi uchun avval «Тип оплаты», «Валюта» va «Прайс лист» tanlangan bo'lishi shart («Для добавления товаров, выберите тип оплаты, валюту и прайс лист»). Excel importi uchun omborni ham tanlang.
5. «Подтвержденный» belgisi: belgilangan — «Есть на складе» (tovar band qilinadi va qoldiq tekshiriladi), olib tashlangan — «Не подтвержден».
6. «Сохранить». To'ldirilmagan majburiy maydon ostida «Это поле обязательно к заполнению» chiqadi.

Bilish kerak:
- Narx tanlangan prays-listdan olinadi; tovar shu prays-listda narxga ega bo'lmasa, narx 0 bo'ladi.
- «Прайс лист» ro'yxati — kirgan foydalanuvchining xodim kartasidagi «Поддерживаемый прайс лист»; kartada bo'lmasa, barcha faol prays-listlar. «Агент» standart — foydalanuvchining o'zi, «Склад» standart — kartadagi birinchi «Связанные склады».
- «Доставщик» ro'yxatida faqat huquq to'plamida «Доставщик» imkoniyati bor xodimlar chiqadi.
- «Недостаточно товара на складе «...»: ... — нужно X, доступно Y» — omborda bo'sh (band qilinmagan) qoldiq yetmaydi. Boshqa buyurtmalar band qilgan tovar mavjud hisoblanmaydi. Avval kirim qiling yoki boshqa ombor tanlang.
- «Агенту запрещено продавать товар: ...» — «Персонал» → «Ограничение продуктов»da agentga faqat ma'lum tovarlar ruxsat etilgan; agent tanlangach ro'yxat toraytiriladi.
- «Превышен лимит агента ...» — agentning tovar bo'yicha limiti tugagan (mahsulot kartasidagi «Добавить лимит»).
- «Создание заказа запрещено в это время» / «Редактирование заказа запрещено в это время» — «Ограничение времени» oynasi (pastga qarang).

Statuslar: «Не подтвержден» → «В процессе» → «Есть на складе» → «Передан доставщику» → «Доставлен»; istalgan bosqichda «Отменен». «Доставлен» va «Отменен» — yakuniy, ulardan boshqa statusga o'tib bo'lmaydi. «Передан доставщику»dan faqat «Есть на складе», «Доставлен» yoki «Отменен»ga o'tiladi.

Buyurtma kartasida:
- «Изменить» yakuniy statusda nofaol; «Быстрая правка» va «Скидка» faqat «Не подтвержден», «В процессе», «Есть на складе»da va tovar bo'lsa faol.
- Bekor qilish (savat belgisi) «Передан доставщику», «Доставлен», «Отменен»da nofaol. «Доставленный заказ нельзя удалить или отменить: оформите возврат от клиента».
- «Клиента, сумму, валюту и склад отгруженного заказа изменить нельзя».
- «Распечатать» bekor qilingan buyurtmada nofaol.
- To'lovni buyurtmaga qo'lda yozib bo'lmaydi: «Оплаты заказа вносятся через кассу». To'lov «Финансы» → «Управления кассой» yoki ro'yxatdagi «Групповая оплата» orqali (kassa huquqi kerak). «Сумма больше остатка заказа» — to'lov qarzdan katta.
- Ro'yxatda bir nechta buyurtmani belgilab, «Передать» (Активные) yoki «Доставлен» (Доставляется) bilan statusni birdaniga o'zgartirish mumkin.

### «Продажи» → «Возвраты»
Mijozdan qaytgan tovar. Turlari: «Возврат по конкретному заказу», «Возврат по конкретному клиенту», «Возврат по всем заказам», «Возврат по старой базе».
- Buyurtma bo'yicha qaytarish faqat jo'natilgan buyurtmaga mumkin: «Возврат возможен только по отгруженному заказу (В пути / Доставлено)». Buyurtmadagi miqdordan (oldingi qaytarishlarni ayirib) ko'p qaytarib bo'lmaydi: «По этому заказу нечего возвращать».
- Tovar qo'shishdan oldin mijozni tanlang («Для добавления товаров выберите клиента.»). Ombor majburiy: «Укажите склад возврата».
- Faqat qabul qilingan qaytarish omborga tovar qo'shadi va summani mijoz hisobiga yozadi (qarzi kamayadi). Qabul qilingan qaytarishda tovar qo'shib/o'chirib bo'lmaydi; avval «Отменить приемку».
- Har xil valyutadagi buyurtmalar tovarlari alohida qaytarishda rasmiylashtiriladi.

### «Клиенты»
Yorliqlar: «Не подтвержденные», «Проблемные», «Плановый ОКБ», «Закрытие», «Все». Mijoz topilmasa — «Все» yorlig'ini va filial tanlovini tekshiring.

Yangi mijoz («Добавить»): majburiy — «Наименование», «Филиал», «Тип клиента», «Зона», telefon, yangi mijozda «Адрес» va «Ориентир». Xabarlar: «Заполните название, телефон, тип и зону», «Заполните адрес и ориентир». Zona ro'yxati bo'sh bo'lsa — «Зона» yonidagi «+» («Добавить зону») yoki «Клиенты» → «Территория». Mijoz turlari — «Типы клиентов». «Баланс» (boshlang'ich balans) raqam bo'lishi kerak: «Баланс должен быть числом».

Mijoz kartasi: «АКТИВНОСТЬ», «ЗАДАЧИ», «КЛИЕНТ» («ДЕТАЛИ», «ФИНАНСОВЫЕ НАСТРОЙКИ» — qarz limiti, «ЛОГИ», «ДОГОВОРЫ»), «ОТЧЕТЫ», «ОТКАЗЫ». Excel: «Импортировать», «Обновить с excel». Takror mijozlar — «Анализ дублей».

### «Склад» → «Приход от поставщиков»
Yetkazib beruvchidan kirim. Ochish: xarid huquqi bor manager va admin.
1. «Добавить» → «Поставщик» (yo'q bo'lsa «+добавить»), «Филиал», «Склад назначения», «Организация», «Валюта оплаты», «Тип оплаты», «Дата поставки» — barchasi majburiy.
2. Tovarlar: «добавить товар», «добавить из списка», «импортировать с excel» (avval «Загрузить шаблон»). Miqdor 0 dan katta bo'lsin. Tovar katalogda bo'lishi kerak («Товар не найден в каталоге»).
3. Saqlangach status — «Ожидает». Omborga tushirish uchun qatordagi «Принять на склад»: qabul sanasi postavka sanasidan oldin va bugundan keyin bo'lmaydi («Дата приемки не может быть раньше даты поставки»). Qabul qilingach status «Завершен», tovar omborga tushadi va tannarx hisoblanadi.

Cheklovlar:
- Qabul qilingan postavkada faqat narx, seriya va yaroqlilik muddati o'zgaradi; ombor o'zgarmaydi; postavkani o'chirib bo'lmaydi («Принятую поставку удалить нельзя»).
- «Отменит приёмку» — tovarni ombordan qaytarib chiqaradi (tavsiya etilmaydi). Tovar omborda qolmagan bo'lsa yoki postavka bo'yicha to'lov bo'lsa, bekor qilib bo'lmaydi («По поставке есть оплаты — отменить нельзя»).
- Bekor qilingan postavkani o'zgartirib bo'lmaydi.
- «Добавить расход» — postavkaga qo'shimcha xarajat.

### «Склад» → «Остаток»
Har bir tovarning joriy qoldig'i: «Остаток», «Забронировано» (tasdiqlangan buyurtmalar band qilgan), «В пути», «Доступно» (sotish mumkin bo'lgani), «Брак». Filtrlar: ombor, filial, tur, brend, yetkazib beruvchi, «Только продукты в наличии». «ПРАЙС ЛИСТ» rejimida prays-list tanlanishi kerak («Пожалуйста выберите прайс лист»). Yuqoridagi kartochkalar o'lchov birligi bo'yicha alohida (dona, kg) jamlanadi — bu ataylab qilingan. Tovar nomini bosish uning harakatini ochadi. O'tgan sana qoldig'i — «Остаток на определенную дату».

«Buyurtmaga qoldiq yetmayapti, lekin «Остаток»da bor» — «Доступно» ustuniga qarang: band qilingan miqdor ayiriladi.

### «Передачи между складами»
Omborlar orasida ko'chirish. Majburiy: «Со склада», «На склад» (har xil bo'lishi kerak), sana va tovarlar. Statuslar: «ожидает» → «подтвержден» → «в пути» (tovar jo'natuvchi ombordan chiqadi) → «принят» (qabul qiluvchi omborga tushadi); «отменен». «Сразу передать товары без подтверждения» tasdiqlash bosqichini o'tkazib yuboradi. Qoldiq yetmasa: «Недостаточно товара на складе ...». Sana bugundan keyin bo'lmaydi; qabul sanasi jo'natish sanasidan oldin bo'lmaydi.

### «Списание» va «Инвентаризация»
- «Списание»: ombor, sana, tovarlar. «ожидает» → «закрыт» (tovar hisobdan chiqadi) yoki «отменен».
- «Инвентаризация»: «В ожидании» → «Подтвержденный» (qoldiq hisoblangan miqdorga tenglashtiriladi) yoki «Отменен». Faqat «В ожидании»dagi inventarizatsiya o'zgartiriladi («Изменять можно только инвентаризацию в ожидании»). Sana bugundan keyin bo'lmaydi.

### «Продукты», «Прайс-листы», «Переоценка»
- Mahsulot: majburiy «Наименование» va «Мера». «Продукт с таким наименованием уже существует», «Артикул уже используется», «Штрих-код уже используется» — takror qiymat. «Нельзя удалить: товар есть на складе».
- Prays-listda narx qo'yilmasa, buyurtmada narx 0 chiqadi.

### «Финансы» → «Управления кассой»
Chapda kassalar va balanslari, o'ngda tanlangan kassa amallari («Общий объем» — hammasi). Amallar: «Принять деньги», «Групповой приход», «Приход», «Расход», «Перевод», «Запрос средств»; qator menyusi: «Изменить», «Дублировать», «Печать», «Удалить». Kassa huquqi kerak; o'qish uchun ham moliya/kassa/hisobot huquqi (huquq to'plami bo'lsa).
- «Приход»da kategoriya majburiy («Укажите категорию»); kategoriya turiga qarab mijoz, buyurtma, yetkazib beruvchi yoki postavka so'raladi («Укажите клиента», «Укажите заказ», «Укажите поставку»). Kategoriyalar — «Категории приходов» / «Категории расходов».
- «Недостаточно средств в кассе» — kassa minusga tushmaydi.
- «Касса не относится к выбранному филиалу» — kassa boshqa filialga tegishli.
- «Сумма больше неоплаченного остатка поставки» — yetkazib beruvchiga qarzdan ko'p to'lov.
- Soat belgisi — «Неподтвержденные транзакции».

### «Оплаты от клиентов»
Mijoz to'lovlari: «Не принятые», «Принятые», «Все». Agent yig'gan pul kassaga «Принять на кассу» orqali qabul qilinadi (bir nechtasini belgilab). Kassaga qabul qilingan to'lovni o'zgartirish kassa balansini ham o'zgartiradi.

### Balanslar va qarzlar
«Баланс клиентов» («Групповой приход»), «Долги с заказов» («Групповая оплата»), «Долги по счетам», «Баланс поставщиков», «Баланс сотрудников» — hisobot va tezkor to'lov sahifalari. To'lov tugmalari faqat kassa huquqi bo'lsa ko'rinadi.

### «Персонал» → «Сотрудники»
Majburiy: «Имя», «Фамилия», «Телефон», «Должность», «Филиалы», «Организации». «Доступ к системе» yoqilsa — «Логин», «Права доступа», parol («Подтвердите пароль» bilan bir xil bo'lsin: «Пароли не совпадают»).
- Login va parolni faqat administrator yaratadi/o'zgartiradi («Нет учетной записи для входа. Создать её может только администратор.»).
- Yangi akkaunt birinchi kirishda parolni almashtirishi shart.
- Kartadagi «Поддерживаемый прайс лист», «Связанные склады» buyurtma formasidagi ro'yxat va standart qiymatlarni belgilaydi.
- Huquq to'plami yoki parol o'zgarsa, xodimning sessiyalari tugatiladi.

### «Права доступа»
Faqat administrator. Huquq to'plami nomi va unga kiruvchi «Возможности». «Пользователи» — tizim akkauntlari va ularning «Роль»i. Huquq to'plamli foydalanuvchi faqat ruxsat berilgan bo'limlarni o'zgartiradi; administrator cheklanmaydi.

### «Ограничение времени»
Agentlar buyurtma yaratishi («Создания заказа») va tahrirlashi («Редактировать заказ») mumkin bo'lgan vaqt: «Работает полный день», «Не работает в течении дня», «Работает в данные часы», «Не работает в данные часы». «Действует для всех» yoki «Действует только для выбранных агентов». Toshkent vaqti bo'yicha. Faqat xodimga bog'langan akkauntlarga ta'sir qiladi; administrator va xodimga bog'lanmagan ofis akkauntlari cheklanmaydi. Sozlash — sozlamalar huquqi.

### «Ограничение продуктов»
Agentga faqat tanlangan tovar yoki tovar turlarini sotishga ruxsat beradi. Natija buyurtmada: tovar ro'yxati toraytiriladi, boshqa tovar «Агенту запрещено продавать товар» bilan rad etiladi.

### «Аналитика» va hisobotlar
Bosh sahifa (dashboard) va «Аналитика» menyusidagi hisobotlar faqat ko'rish uchun; viewer ham ishlata oladi. Davr tanlanadi («Сегодня», «Вчера», «Последние 7 дней», «Текущий месяц», «Пред. месяц»). «Старый конструктор отчетов», «Новый конструктор отчетов», «Конструктор тенденция»: hisobotni ishga tushirish hammaga ochiq, saqlash uchun hisobot huquqi kerak. Raqamlar filial tanlovi va davrga bog'liq.

### «Настройки» (tishli g'ildirak)
Guruhlar: «Персонал» («Сотрудники», «Смены», «Должности», «Права доступа», «Транспорт», «Сессия»), «Финансы» («Валюта приложения», «Округление сумм», «Валюты», «Кассы», «Категории приходов», «Категории расходов»), «Продукты», «Клиенты», «Конструкторы», «Поставщики», «Склад» («Склады», «Настройка чека», «Ячейки»), «Разное» («Прайс-листы», «Филиалы», «Организация», «Ограничение времени», «Закрытия дня/месяца», «Интеграция», «Уведомления»). Panelda «Онлайн техподдержка» va «База знаний» ham bor. O'zgartirish uchun sozlamalar (yoki tegishli moliya/ombor) huquqi kerak.

## 4. Tez-tez uchraydigan holatlar

- «Tugma bosilmaydi / kulrang» → hujjat statusi ruxsat bermaydi (yakuniy buyurtma, qabul qilingan postavka) yoki majburiy maydon to'ldirilmagan.
- «Tugma umuman yo'q» → huquq yetmaydi yoki viewer rol.
- «Saqlashda «У вас нет прав на это действие»» → viewer yoki huquq to'plamida kerakli imkoniyat yo'q; administratorga murojaat.
- «Ro'yxat bo'sh / ma'lumot yo'qoldi» → filial tanlovi, sana davri, manzil satrida qolgan filtr, bekor qilingan buyurtmalar yashirilgan, mijozlarda boshqa yorliq.
- «Mijoz select'da yo'q» → ro'yxat eng yangi 50 tani ko'rsatadi; nomini yozing. Filial tanlovini tekshiring.
- «Tovar qo'shib bo'lmayapti» → «Тип оплаты», «Валюта», «Прайс лист» tanlanmagan; agentga «Ограничение продуктов» qo'yilgan.
- «Narx 0» → tovarning tanlangan prays-listda narxi yo'q.
- «Qoldiq bor, lekin yetmaydi deydi» → boshqa buyurtmalar band qilgan; «Доступно» ustuniga qarang; ombor to'g'ri tanlanganini tekshiring.
- «Buyurtma yarata olmayapman, faqat ma'lum soatda» → «Ограничение времени».
- «Pul kassaga tushmadi» → agent to'lovi «Оплаты от клиентов» → «Не принятые»da; «Принять на кассу» kerak.
- «Kirimdagi tovar omborda yo'q» → postavka «Ожидает» holatida; «Принять на склад» bosilmagan.
- «Ko'chirilgan tovar yetib kelmadi» → ko'chirish «в пути»da; qabul qiluvchi omborda «принят» qilinmagan.
- «Tizimdan chiqarib yubordi» → sessiya tugatilgan yoki parol/huquq o'zgargan; qayta kiring.

Qo'llanmada javob topilmasa yoki ekranda kutilmagan server xatosi (masalan, sahifa umuman ochilmasa, xato matni yuqoridagilarga o'xshamasa) bo'lsa — bu dasturchiga yuboriladigan xato.
