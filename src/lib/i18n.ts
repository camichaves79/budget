import { useSyncExternalStore } from 'react';

/**
 * App localization (2026-09): UI strings, locale-aware dates/amounts, RTL.
 *
 * - First run: the language follows the device (navigator.language) when we
 *   have a catalog for it; otherwise English.
 * - The Settings → Language picker stores an explicit choice (localStorage
 *   `budget.language`) which wins from then on.
 * - Branch 1 ships en/es/fr/pt. Branch 2 adds zh/hi/bn/ru/ur/ar (RTL for
 *   ur/ar via `dir` in LANGS).
 * - Translations are model-authored; the user verifies on the iPhone.
 */

export type Lang = 'en' | 'es' | 'fr' | 'pt' | 'zh' | 'hi' | 'bn' | 'ru' | 'ur' | 'ar';

export interface LangMeta {
  /** Native name shown in the language picker. */
  name: string;
  dir: 'ltr' | 'rtl';
  /** BCP-47 tag for Intl (dates, numbers, plurals). */
  intl: string;
  /** Money symbol placement for this locale. */
  money: { suffix: boolean; space: boolean };
}

export const LANGS: Record<Lang, LangMeta> = {
  en: { name: 'English', dir: 'ltr', intl: 'en', money: { suffix: false, space: true } },
  es: { name: 'Español', dir: 'ltr', intl: 'es', money: { suffix: false, space: true } },
  fr: { name: 'Français', dir: 'ltr', intl: 'fr', money: { suffix: true, space: true } },
  pt: { name: 'Português', dir: 'ltr', intl: 'pt', money: { suffix: false, space: true } },
  zh: { name: '中文', dir: 'ltr', intl: 'zh-CN', money: { suffix: false, space: false } },
  hi: { name: 'हिन्दी', dir: 'ltr', intl: 'hi', money: { suffix: false, space: false } },
  bn: { name: 'বাংলা', dir: 'ltr', intl: 'bn', money: { suffix: false, space: false } },
  ru: { name: 'Русский', dir: 'ltr', intl: 'ru', money: { suffix: true, space: true } },
  ur: { name: 'اردو', dir: 'rtl', intl: 'ur', money: { suffix: false, space: false } },
  ar: { name: 'العربية', dir: 'rtl', intl: 'ar', money: { suffix: true, space: true } },
};

/** A phrase is a plain string or a CLDR plural form set ({n} required). */
export type Phrase = string | Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>>;

/* ------------------------------------------------------------------ */
/* English catalog — the key source of truth.                          */
/* ------------------------------------------------------------------ */

const en = {
  close: 'Close',

  'tabs.cashFlow': 'Cash Flow',
  'tabs.budgets': 'Budgets',
  'tabs.categories': 'Categories',
  'tabs.settings': 'Settings',
  'tabs.mainNav': 'Main navigation',
  'tabs.addTransaction': 'Add transaction',

  'nav.prevPeriod': 'Previous period',
  'nav.nextPeriod': 'Next period',
  'nav.jumpToToday': 'Jump to today',

  'dashboard.cashFlow': 'Cash flow:',
  'dashboard.transactions': 'Transactions:',
  'dashboard.income': 'Income',
  'dashboard.expenses': 'Expenses',
  'dashboard.balance': 'Balance',
  'dashboard.periodSummary': 'Period summary',
  'dashboard.txList': 'Transactions',
  'dashboard.noTxTitle': 'No transactions in this period',
  'dashboard.noTxHintBefore': 'Tap ',
  'dashboard.noTxHintAfter': ' to record income or an expense.',
  'dashboard.tellMe': 'Tell me what the transaction is:',
  'dashboard.editTx': 'Edit transaction',

  'tx.typeAria': 'Transaction type',
  'tx.transaction': 'transaction',
  'tx.expense': 'Expense',
  'tx.income': 'Income',
  'tx.amount': 'Amount',
  'tx.category': 'Category',
  'tx.pickCategory': '— Pick a category —',
  'tx.date': 'Date',
  'tx.note': 'Note (optional)',
  'tx.saveChanges': 'Save changes',
  'tx.addTx': 'Add transaction',
  'tx.deleteTx': 'Delete transaction',
  'tx.deleteTxTitle': 'Delete transaction?',
  'tx.deleteTxMsg': 'This removes the transaction permanently.',
  'tx.errAmount': 'Enter a valid amount greater than zero.',
  'tx.errCategory': 'Pick a category.',
  'tx.errDate': 'Pick a date.',
  'tx.amountBad': 'Not a valid amount',
  'tx.amountZero': 'Amount must be greater than zero',

  'smart.submit': 'Submit',
  'smart.submitting': 'Submitting…',
  'smart.retrying': 'Retrying…',
  'smart.manualInstead': 'Enter manually instead',
  'smart.placeholder': "Use your keyboard's microphone 🎤",
  'smart.describe': 'Describe the transaction',
  'smart.smartInstead': '⚡ Use smart entry instead',
  'smart.errEmpty': 'Tell me what you spent first.',
  'smart.unsureOne': "I'm only {pct}% sure about this one — check the details. Nothing is saved yet.",
  'smart.unsureMany':
    "I'm only {pct}% sure about this one ({pos} of {total}) — check the details. Nothing is saved for these yet.",
  'smart.almostOne': 'Almost there — pick the missing details. Nothing is saved yet.',
  'smart.almostMany': 'Almost there — {pos} of {total} need details. Nothing is saved for these yet.',
  'smart.saveNext': 'Save & next',
  'smart.skip': 'Skip this one',
  'smart.backToText': 'Back to text',
  'smart.cancel': 'Cancel',
  'smart.recorded': 'Recorded ✓ — need a change? Open the list and tap any transaction to edit it.',
  'smart.spentReceived': 'Spent / Received',
  'smart.total': 'Total',
  'smart.done': 'Done',
  'smart.recordMore': 'Record more',
  'smart.addedOne': 'Added {name} · {amount}',
  'smart.addedBatch': {
    one: 'Added {n} transaction · {amount}',
    other: 'Added {n} transactions · {amount}',
  },
  'smart.addedBatchNoAmount': { one: 'Added {n} transaction', other: 'Added {n} transactions' },
  'smart.addedSimple': 'Added · {amount}',

  'paywall.title': "You've used today's free smart entries",
  'paywall.body': 'Smart entry is free for {n} parses a day. Get unlimited smart entry for a full year — $5 USD.',
  'paywall.signingIn': 'Signing in…',
  'paywall.signInToUnlock': 'Sign in with Google to unlock',
  'paywall.completing': 'Completing purchase…',
  'paywall.opening': 'Opening checkout…',
  'paywall.completePurchase': 'Complete your purchase',
  'paywall.unlock': 'Unlock unlimited smart entry · $5/year',
  'paywall.signInHint':
    'Sign in with Google first — your license gets saved to your account and restored on any device or reinstall.',
  'paywall.resetMidnight': 'Free entries reset at midnight. Manual entry always works, with or without a license.',
  'paywall.purchaseFailed': "That purchase couldn't be completed. Contact the app owner if the payment went through.",
  'paywall.unreachable': "Couldn't reach the licensing service. Check your connection and try again.",
  'paywall.checkoutMissing': 'The checkout link is not set up for this build yet. Contact the app owner.',

  'cats.categories': 'Categories',
  'cats.expenses': 'Expenses',
  'cats.income': 'Income',
  'cats.addCategory': '+ Add category',
  'cats.newCategory': 'New category',
  'cats.editCategory': 'Edit category',
  'cats.deleteCategoryTitle': 'Delete category?',
  'cats.deleteReassign': 'Transactions in “{from}” will be moved to “{to}”. Its budget (if any) is removed.',
  'cats.deleteSimple': 'This category will be removed.',
  'cats.archived': 'archived',
  'cats.deleteAria': 'Delete {name}',
  'cats.name': 'Name',
  'cats.namePlaceholder': 'e.g. Mascotas',
  'cats.emoji': 'Emoji',
  'cats.typeAria': 'Category type',
  'cats.addCat': 'Add category',
  'cats.errName': 'Give the category a name.',
  'cats.errEmoji': 'Pick an emoji for the category.',

  'seed.housing': 'Housing',
  'seed.utilities': 'Utilities',
  'seed.groceries': 'Groceries',
  'seed.transport': 'Transport',
  'seed.health': 'Health',
  'seed.education': 'Education',
  'seed.entertainment': 'Entertainment',
  'seed.restaurants': 'Restaurants',
  'seed.clothing': 'Clothing',
  'seed.other': 'Other',
  'seed.salary': 'Salary',
  'seed.freelance': 'Freelance',
  'seed.otherIncome': 'Other income',

  'budgets.spentOf': 'spent of',
  'budgets.budgeted': 'budgeted',
  'budgets.left': '{amount} left',
  'budgets.noExpCats': 'No expense categories',
  'budgets.noExpCatsHint': 'Add an expense category in the Categories tab first.',
  'budgets.withBudgetsAria': 'Categories with budgets',
  'budgets.withoutBudgetsAria': 'Categories without budgets',
  'budgets.noLimitYet': 'No limit yet',
  'budgets.setLimit': 'Set a limit',
  'budgets.spentLabel': '{amount} spent',
  'budgets.overBy': 'Over budget by {amount}',
  'budgets.monthlyLimit': 'Monthly limit',
  'budgets.removeLimit': 'Remove limit',
  'budgets.saveLimit': 'Save limit',
  'budgets.spentThisPeriod': '{amount} spent in this category this period.',
  'budgets.noneThisPeriod': 'No spending in this category this period yet.',

  'settings.data': 'Data',
  'settings.exportData': 'Export data',
  'settings.exportDesc': 'Download all your data as JSON.',
  'settings.export': 'Export',
  'settings.importData': 'Import data',
  'settings.importDesc': 'Replace current data with a backup.',
  'settings.import': 'Import',
  'settings.resetApp': 'Reset app',
  'settings.resetDesc': 'Erase all transactions and budgets.',
  'settings.reset': 'Reset',
  'settings.budgetPeriod': 'Budget period',
  'settings.periodStarts': 'Period starts on',
  'settings.periodDesc': 'Runs from this day until the day before it next month.',
  'settings.periodAria': 'Period start day',
  'settings.language': 'Language',
  'settings.languageAria': 'App language',
  'settings.about': 'About',
  'settings.aboutTitle': 'Personal budget tracker.',
  'settings.aboutData': 'Data stays on this device — export to back up.',
  'settings.aboutCurrency': 'Currency: COP, integer pesos ($ 1.234).',
  'settings.replaceTitle': 'Replace all data?',
  'settings.replaceMsg': 'Importing a backup replaces everything currently in the app. This cannot be undone.',
  'settings.replaceConfirm': 'Replace data',
  'settings.resetTitle': 'Reset the app?',
  'settings.resetMsg':
    'This erases ALL transactions, budgets, and custom categories. You should export a backup first.',
  'settings.eraseAll': 'Erase everything',
  'settings.sureTitle': 'Are you absolutely sure?',
  'settings.sureMsg': 'There is no undo. Your data will be gone forever.',
  'settings.yesErase': 'Yes, erase everything',
  'settings.ordinal': { one: '{n}st', two: '{n}nd', few: '{n}rd', other: '{n}th' },

  'license.smartEntry': 'Smart entry',
  'license.unlimited': 'Unlimited license',
  'license.freePlan': 'Free plan',
  'license.until': 'Unlimited smart entry until {date}.',
  'license.freeLeft': '{n} of {m} free entries today.',
  'license.active': 'Active',
  'license.unlockYear': 'Unlock · $5/year',
  'license.signInUnlock': 'Sign in to unlock',
  'license.purchaseWaiting': 'Purchase waiting',
  'license.finishPurchase': "Finish a purchase that didn't complete.",
  'license.complete': 'Complete purchase',
  'license.signInComplete': 'Sign in to complete',
  'license.account': 'Account',
  'license.signedIn': 'Signed in',
  'license.accountDesc': '{email} — license saved to your account.',
  'license.accountHint': 'Sign in to keep your license across devices.',
  'license.signOut': 'Sign out',
  'license.signInGoogle': 'Sign in with Google',
  'license.restore': 'Restore license',
  'license.restoreDesc': 'Get your license back on this device.',
  'license.restoreBtn': 'Restore',
  'license.haveKey': 'Have a license key?',
  'license.keyFallback': "Fallback if the automatic setup didn't complete.",
  'license.pasteKey': 'Paste license key',
  'license.keyAria': 'License key',
  'license.activate': 'Activate',
  'license.working': 'Working…',
  'license.activeNote': 'License active ✓ — smart entry is unlimited.',
  'license.lostNote': 'License no longer valid — smart entry is back to the free plan.',
  'license.noLicense': 'No license found for this account.',
  'license.verifyFailed': 'Sign-in could not be verified. Try signing out and back in.',
  'license.signInFirst': 'Sign in first — licenses are tied to your account.',
  'license.badKey': 'That key is not valid. Check it and try again.',

  'parse.notConfigured': "Smart entry isn't set up for this build. Ask the app owner to finish the setup.",
  'parse.nothing': 'Nothing to parse yet.',
  'parse.unreachable': "Couldn't reach the parsing service. Check your connection and try again.",
  'parse.licenseGone': "Your license isn't valid anymore. Check it in Settings — manual entry still works.",
  'parse.licenseLimit': "You've reached today's smart-entry limit — it resets at midnight.",
  'parse.busy': 'The parsing service is busy right now. Try again in a moment.',
  'parse.trouble': 'The parsing service is having trouble. Try again shortly.',
  'parse.unexpected': 'The parsing service answered unexpectedly. Try again shortly.',
  'parse.unclear': "Couldn't understand that. Try rewording it, or enter it manually.",

  'licensing.unexpected': 'The licensing service answered unexpectedly. Try again shortly.',
  'licensing.emailMismatch':
    'This purchase belongs to a different email — sign in with the Google account used at checkout.',
  'licensing.rateLimited': 'Too many attempts in a short time. Wait a few minutes and try again.',
  'licensing.notPaid': "Your payment hasn't been confirmed yet. Try again in a moment.",
  'licensing.refunded': 'That purchase was refunded, so no license was issued.',
  'licensing.notFound':
    "That purchase reference wasn't found. If the payment went through, contact the app owner.",
  'licensing.unauthorized': 'The licensing service rejected the request. Check the app setup.',
  'licensing.notConfigured':
    "The licensing service isn't fully set up yet — the app owner is on it. Try again shortly.",
  'licensing.serverError': 'Server error: {reason}',
  'licensing.unreachable': "Couldn't reach the licensing service. Check your connection and try again.",
  'licensing.verifyFailed': 'Sign-in could not be verified. Try signing out and back in.',
  'licensing.signInRequired': 'Sign in with Google first — licenses are tied to your account.',
  'licensing.keyEmailMismatch':
    'This key belongs to a different email — sign in with the Google account used at checkout.',
} as const;

export type MsgKey = keyof typeof en;
type Dict = Partial<Record<MsgKey, Phrase>>;

/* ------------------------------------------------------------------ */
/* Spanish (es)                                                        */
/* ------------------------------------------------------------------ */

const es: Dict = {
  close: 'Cerrar',
  'tabs.cashFlow': 'Flujo de caja',
  'tabs.budgets': 'Presupuestos',
  'tabs.categories': 'Categorías',
  'tabs.settings': 'Ajustes',
  'tabs.mainNav': 'Navegación principal',
  'tabs.addTransaction': 'Agregar transacción',
  'nav.prevPeriod': 'Período anterior',
  'nav.nextPeriod': 'Período siguiente',
  'nav.jumpToToday': 'Ir a hoy',
  'dashboard.cashFlow': 'Flujo de caja:',
  'dashboard.transactions': 'Transacciones:',
  'dashboard.income': 'Ingresos',
  'dashboard.expenses': 'Gastos',
  'dashboard.balance': 'Balance',
  'dashboard.periodSummary': 'Resumen del período',
  'dashboard.txList': 'Transacciones',
  'dashboard.noTxTitle': 'No hay transacciones en este período',
  'dashboard.noTxHintBefore': 'Toca ',
  'dashboard.noTxHintAfter': ' para registrar un ingreso o un gasto.',
  'dashboard.tellMe': 'Dime cuál es la transacción:',
  'dashboard.editTx': 'Editar transacción',
  'tx.typeAria': 'Tipo de transacción',
  'tx.transaction': 'transacción',
  'tx.expense': 'Gasto',
  'tx.income': 'Ingreso',
  'tx.amount': 'Monto',
  'tx.category': 'Categoría',
  'tx.pickCategory': '— Elige una categoría —',
  'tx.date': 'Fecha',
  'tx.note': 'Nota (opcional)',
  'tx.saveChanges': 'Guardar cambios',
  'tx.addTx': 'Agregar transacción',
  'tx.deleteTx': 'Eliminar transacción',
  'tx.deleteTxTitle': '¿Eliminar transacción?',
  'tx.deleteTxMsg': 'Esto elimina la transacción de forma permanente.',
  'tx.errAmount': 'Ingresa un monto válido mayor que cero.',
  'tx.errCategory': 'Elige una categoría.',
  'tx.errDate': 'Elige una fecha.',
  'tx.amountBad': 'Monto no válido',
  'tx.amountZero': 'El monto debe ser mayor que cero',
  'smart.submit': 'Enviar',
  'smart.submitting': 'Enviando…',
  'smart.retrying': 'Reintentando…',
  'smart.manualInstead': 'Mejor ingrésalo manualmente',
  'smart.placeholder': 'Usa el micrófono de tu teclado 🎤',
  'smart.describe': 'Describe la transacción',
  'smart.smartInstead': '⚡ Usar entrada inteligente',
  'smart.errEmpty': 'Primero dime qué gastaste.',
  'smart.unsureOne': 'Solo tengo {pct}% de seguridad en esta — revisa los detalles. Aún no se guarda nada.',
  'smart.unsureMany':
    'Solo tengo {pct}% de seguridad en esta ({pos} de {total}) — revisa los detalles. Aún no se guarda nada.',
  'smart.almostOne': 'Casi listo — elige lo que falta. Aún no se guarda nada.',
  'smart.almostMany': 'Casi listo — {pos} de {total} necesitan detalles. Aún no se guarda nada.',
  'smart.saveNext': 'Guardar y continuar',
  'smart.skip': 'Saltar esta',
  'smart.backToText': 'Volver al texto',
  'smart.cancel': 'Cancelar',
  'smart.recorded': 'Registrado ✓ — ¿necesitas un cambio? Abre la lista y toca cualquier transacción para editarla.',
  'smart.spentReceived': 'Gastado / Recibido',
  'smart.total': 'Total',
  'smart.done': 'Listo',
  'smart.recordMore': 'Registrar más',
  'smart.addedOne': 'Agregada {name} · {amount}',
  'smart.addedBatch': { one: 'Agregada {n} transacción · {amount}', other: 'Agregadas {n} transacciones · {amount}' },
  'smart.addedBatchNoAmount': { one: 'Agregada {n} transacción', other: 'Agregadas {n} transacciones' },
  'smart.addedSimple': 'Agregado · {amount}',
  'paywall.title': 'Ya usaste las entradas inteligentes gratis de hoy',
  'paywall.body':
    'La entrada inteligente es gratis para {n} consultas al día. Obtén entrada inteligente ilimitada por todo un año — 5 USD.',
  'paywall.signingIn': 'Iniciando sesión…',
  'paywall.signInToUnlock': 'Inicia sesión con Google para desbloquear',
  'paywall.completing': 'Completando la compra…',
  'paywall.opening': 'Abriendo el pago…',
  'paywall.completePurchase': 'Completa tu compra',
  'paywall.unlock': 'Desbloquea la entrada inteligente ilimitada · 5 USD/año',
  'paywall.signInHint':
    'Primero inicia sesión con Google — tu licencia se guarda en tu cuenta y se restaura en cualquier dispositivo o reinstalación.',
  'paywall.resetMidnight': 'Las entradas gratis se reinician a medianoche. La entrada manual siempre funciona, con o sin licencia.',
  'paywall.purchaseFailed': 'No se pudo completar esa compra. Contacta al dueño de la app si el pago se realizó.',
  'paywall.unreachable': 'No se pudo contactar el servicio de licencias. Revisa tu conexión e inténtalo de nuevo.',
  'paywall.checkoutMissing': 'El enlace de pago no está configurado en esta versión todavía. Contacta al dueño de la app.',
  'cats.categories': 'Categorías',
  'cats.expenses': 'Gastos',
  'cats.income': 'Ingresos',
  'cats.addCategory': '+ Agregar categoría',
  'cats.newCategory': 'Nueva categoría',
  'cats.editCategory': 'Editar categoría',
  'cats.deleteCategoryTitle': '¿Eliminar categoría?',
  'cats.deleteReassign': 'Las transacciones de «{from}» se moverán a «{to}». Su presupuesto (si existe) se elimina.',
  'cats.deleteSimple': 'Esta categoría se eliminará.',
  'cats.archived': 'archivada',
  'cats.deleteAria': 'Eliminar {name}',
  'cats.name': 'Nombre',
  'cats.namePlaceholder': 'p. ej. Mascotas',
  'cats.emoji': 'Emoji',
  'cats.typeAria': 'Tipo de categoría',
  'cats.addCat': 'Agregar categoría',
  'cats.errName': 'Ponle un nombre a la categoría.',
  'cats.errEmoji': 'Elige un emoji para la categoría.',
  'seed.housing': 'Vivienda',
  'seed.utilities': 'Servicios',
  'seed.groceries': 'Mercado',
  'seed.transport': 'Transporte',
  'seed.health': 'Salud',
  'seed.education': 'Educación',
  'seed.entertainment': 'Entretenimiento',
  'seed.restaurants': 'Restaurantes',
  'seed.clothing': 'Ropa',
  'seed.other': 'Otros',
  'seed.salary': 'Salario',
  'seed.freelance': 'Freelance',
  'seed.otherIncome': 'Otros ingresos',
  'budgets.spentOf': 'gastados de',
  'budgets.budgeted': 'presupuestados',
  'budgets.left': 'Quedan {amount}',
  'budgets.noExpCats': 'No hay categorías de gasto',
  'budgets.noExpCatsHint': 'Primero agrega una categoría de gasto en la pestaña Categorías.',
  'budgets.withBudgetsAria': 'Categorías con presupuesto',
  'budgets.withoutBudgetsAria': 'Categorías sin presupuesto',
  'budgets.noLimitYet': 'Aún sin límite',
  'budgets.setLimit': 'Fijar un límite',
  'budgets.spentLabel': '{amount} gastados',
  'budgets.overBy': 'Sobre el presupuesto por {amount}',
  'budgets.monthlyLimit': 'Límite mensual',
  'budgets.removeLimit': 'Quitar límite',
  'budgets.saveLimit': 'Guardar límite',
  'budgets.spentThisPeriod': '{amount} gastados en esta categoría este período.',
  'budgets.noneThisPeriod': 'Aún no hay gastos en esta categoría este período.',
  'settings.data': 'Datos',
  'settings.exportData': 'Exportar datos',
  'settings.exportDesc': 'Descarga todos tus datos como JSON.',
  'settings.export': 'Exportar',
  'settings.importData': 'Importar datos',
  'settings.importDesc': 'Reemplaza los datos actuales con una copia de seguridad.',
  'settings.import': 'Importar',
  'settings.resetApp': 'Reiniciar app',
  'settings.resetDesc': 'Borra todas las transacciones y presupuestos.',
  'settings.reset': 'Reiniciar',
  'settings.budgetPeriod': 'Período del presupuesto',
  'settings.periodStarts': 'El período comienza el',
  'settings.periodDesc': 'Va desde este día hasta el día anterior del mes siguiente.',
  'settings.periodAria': 'Día de inicio del período',
  'settings.language': 'Idioma',
  'settings.languageAria': 'Idioma de la app',
  'settings.about': 'Acerca de',
  'settings.aboutTitle': 'Rastreador de presupuesto personal.',
  'settings.aboutData': 'Tus datos se quedan en este dispositivo — exporta para respaldarlos.',
  'settings.aboutCurrency': 'Moneda: COP, pesos enteros ($ 1.234).',
  'settings.replaceTitle': '¿Reemplazar todos los datos?',
  'settings.replaceMsg': 'Importar una copia reemplaza todo lo que hay en la app. Esto no se puede deshacer.',
  'settings.replaceConfirm': 'Reemplazar datos',
  'settings.resetTitle': '¿Reiniciar la app?',
  'settings.resetMsg':
    'Esto borra TODAS las transacciones, presupuestos y categorías personalizadas. Deberías exportar una copia primero.',
  'settings.eraseAll': 'Borrar todo',
  'settings.sureTitle': '¿Estás totalmente seguro?',
  'settings.sureMsg': 'No hay vuelta atrás. Tus datos desaparecerán para siempre.',
  'settings.yesErase': 'Sí, borra todo',
  'settings.ordinal': { other: '{n}º' },
  'license.smartEntry': 'Entrada inteligente',
  'license.unlimited': 'Licencia ilimitada',
  'license.freePlan': 'Plan gratuito',
  'license.until': 'Entrada inteligente ilimitada hasta el {date}.',
  'license.freeLeft': '{n} de {m} entradas gratis hoy.',
  'license.active': 'Activa',
  'license.unlockYear': 'Desbloquear · 5 USD/año',
  'license.signInUnlock': 'Inicia sesión para desbloquear',
  'license.purchaseWaiting': 'Compra en espera',
  'license.finishPurchase': 'Termina una compra que no se completó.',
  'license.complete': 'Completar compra',
  'license.signInComplete': 'Inicia sesión para completar',
  'license.account': 'Cuenta',
  'license.signedIn': 'Sesión iniciada',
  'license.accountDesc': '{email} — licencia guardada en tu cuenta.',
  'license.accountHint': 'Inicia sesión para conservar tu licencia en otros dispositivos.',
  'license.signOut': 'Cerrar sesión',
  'license.signInGoogle': 'Inicia sesión con Google',
  'license.restore': 'Restaurar licencia',
  'license.restoreDesc': 'Recupera tu licencia en este dispositivo.',
  'license.restoreBtn': 'Restaurar',
  'license.haveKey': '¿Tienes una clave de licencia?',
  'license.keyFallback': 'Respaldo si la configuración automática no se completó.',
  'license.pasteKey': 'Pega la clave de licencia',
  'license.keyAria': 'Clave de licencia',
  'license.activate': 'Activar',
  'license.working': 'Trabajando…',
  'license.activeNote': 'Licencia activa ✓ — la entrada inteligente es ilimitada.',
  'license.lostNote': 'La licencia ya no es válida — la entrada inteligente vuelve al plan gratuito.',
  'license.noLicense': 'No se encontró ninguna licencia para esta cuenta.',
  'license.verifyFailed': 'No se pudo verificar el inicio de sesión. Cierra sesión y vuelve a entrar.',
  'license.signInFirst': 'Primero inicia sesión — las licencias están vinculadas a tu cuenta.',
  'license.badKey': 'Esa clave no es válida. Revísala e inténtalo de nuevo.',
  'parse.notConfigured': 'La entrada inteligente no está configurada en esta versión. Pide al dueño de la app que termine la configuración.',
  'parse.nothing': 'Aún no hay nada que analizar.',
  'parse.unreachable': 'No se pudo contactar el servicio de análisis. Revisa tu conexión e inténtalo de nuevo.',
  'parse.licenseGone': 'Tu licencia ya no es válida. Revísala en Ajustes — la entrada manual sigue funcionando.',
  'parse.licenseLimit': 'Llegaste al límite de entradas inteligentes de hoy — se reinicia a medianoche.',
  'parse.busy': 'El servicio de análisis está ocupado ahora. Inténtalo en un momento.',
  'parse.trouble': 'El servicio de análisis tiene problemas. Inténtalo en breve.',
  'parse.unexpected': 'El servicio de análisis respondió de forma inesperada. Inténtalo en breve.',
  'parse.unclear': 'No se pudo entender eso. Intenta decirlo de otra forma, o ingrésalo manualmente.',
  'licensing.unexpected': 'El servicio de licencias respondió de forma inesperada. Inténtalo en breve.',
  'licensing.emailMismatch': 'Esta compra pertenece a otro correo — inicia sesión con la cuenta de Google usada en el pago.',
  'licensing.rateLimited': 'Demasiados intentos en poco tiempo. Espera unos minutos e inténtalo de nuevo.',
  'licensing.notPaid': 'Tu pago aún no se ha confirmado. Inténtalo en un momento.',
  'licensing.refunded': 'Esa compra fue reembolsada, así que no se emitió ninguna licencia.',
  'licensing.notFound': 'No se encontró esa referencia de compra. Si el pago se realizó, contacta al dueño de la app.',
  'licensing.unauthorized': 'El servicio de licencias rechazó la solicitud. Revisa la configuración de la app.',
  'licensing.notConfigured': 'El servicio de licencias no está listo todavía — el dueño de la app está en eso. Inténtalo en breve.',
  'licensing.serverError': 'Error del servidor: {reason}',
  'licensing.unreachable': 'No se pudo contactar el servicio de licencias. Revisa tu conexión e inténtalo de nuevo.',
  'licensing.verifyFailed': 'No se pudo verificar el inicio de sesión. Cierra sesión y vuelve a entrar.',
  'licensing.signInRequired': 'Primero inicia sesión con Google — las licencias están vinculadas a tu cuenta.',
  'licensing.keyEmailMismatch': 'Esta clave pertenece a otro correo — inicia sesión con la cuenta de Google usada en el pago.',
};

/* ------------------------------------------------------------------ */
/* French (fr)                                                         */
/* ------------------------------------------------------------------ */

const fr: Dict = {
  close: 'Fermer',
  'tabs.cashFlow': 'Flux de trésorerie',
  'tabs.budgets': 'Budgets',
  'tabs.categories': 'Catégories',
  'tabs.settings': 'Réglages',
  'tabs.mainNav': 'Navigation principale',
  'tabs.addTransaction': 'Ajouter une transaction',
  'nav.prevPeriod': 'Période précédente',
  'nav.nextPeriod': 'Période suivante',
  'nav.jumpToToday': "Aller à aujourd'hui",
  'dashboard.cashFlow': 'Flux de trésorerie :',
  'dashboard.transactions': 'Transactions :',
  'dashboard.income': 'Revenus',
  'dashboard.expenses': 'Dépenses',
  'dashboard.balance': 'Solde',
  'dashboard.periodSummary': 'Résumé de la période',
  'dashboard.txList': 'Transactions',
  'dashboard.noTxTitle': 'Aucune transaction sur cette période',
  'dashboard.noTxHintBefore': 'Touchez ',
  'dashboard.noTxHintAfter': ' pour enregistrer un revenu ou une dépense.',
  'dashboard.tellMe': 'Dites-moi quelle est la transaction :',
  'dashboard.editTx': 'Modifier la transaction',
  'tx.typeAria': 'Type de transaction',
  'tx.transaction': 'transaction',
  'tx.expense': 'Dépense',
  'tx.income': 'Revenu',
  'tx.amount': 'Montant',
  'tx.category': 'Catégorie',
  'tx.pickCategory': '— Choisissez une catégorie —',
  'tx.date': 'Date',
  'tx.note': 'Note (facultatif)',
  'tx.saveChanges': 'Enregistrer',
  'tx.addTx': 'Ajouter la transaction',
  'tx.deleteTx': 'Supprimer la transaction',
  'tx.deleteTxTitle': 'Supprimer la transaction ?',
  'tx.deleteTxMsg': 'Cette transaction sera supprimée définitivement.',
  'tx.errAmount': 'Saisissez un montant valide supérieur à zéro.',
  'tx.errCategory': 'Choisissez une catégorie.',
  'tx.errDate': 'Choisissez une date.',
  'tx.amountBad': 'Montant non valide',
  'tx.amountZero': 'Le montant doit être supérieur à zéro',
  'smart.submit': 'Envoyer',
  'smart.submitting': 'Envoi…',
  'smart.retrying': 'Nouvel essai…',
  'smart.manualInstead': 'Saisir manuellement',
  'smart.placeholder': 'Utilisez le micro de votre clavier 🎤',
  'smart.describe': 'Décrivez la transaction',
  'smart.smartInstead': '⚡ Utiliser la saisie intelligente',
  'smart.errEmpty': "Dites-moi d'abord ce que vous avez dépensé.",
  'smart.unsureOne': "Je ne suis sûr qu'à {pct} % pour celle-ci — vérifiez les détails. Rien n'est encore enregistré.",
  'smart.unsureMany':
    "Je ne suis sûr qu'à {pct} % pour celle-ci ({pos} sur {total}) — vérifiez les détails. Rien n'est encore enregistré.",
  'smart.almostOne': "Presque — complétez les détails manquants. Rien n'est encore enregistré.",
  'smart.almostMany': "Presque — {pos} sur {total} ont besoin de détails. Rien n'est encore enregistré.",
  'smart.saveNext': 'Enregistrer et continuer',
  'smart.skip': 'Passer celle-ci',
  'smart.backToText': 'Retour au texte',
  'smart.cancel': 'Annuler',
  'smart.recorded': "Enregistré ✓ — besoin d'un changement ? Ouvrez la liste et touchez une transaction pour la modifier.",
  'smart.spentReceived': 'Dépensé / Reçu',
  'smart.total': 'Total',
  'smart.done': 'Terminé',
  'smart.recordMore': 'Enregistrer plus',
  'smart.addedOne': 'Ajoutée : {name} · {amount}',
  'smart.addedBatch': {
    one: '{n} transaction ajoutée · {amount}',
    other: '{n} transactions ajoutées · {amount}',
  },
  'smart.addedBatchNoAmount': { one: '{n} transaction ajoutée', other: '{n} transactions ajoutées' },
  'smart.addedSimple': 'Ajouté · {amount}',
  'paywall.title': "Vous avez utilisé les saisies intelligentes gratuites du jour",
  'paywall.body':
    "La saisie intelligente est gratuite pour {n} analyses par jour. Profitez d'une saisie intelligente illimitée pendant un an — 5 $ US.",
  'paywall.signingIn': 'Connexion…',
  'paywall.signInToUnlock': 'Connectez-vous avec Google pour débloquer',
  'paywall.completing': "Finalisation de l'achat…",
  'paywall.opening': 'Ouverture du paiement…',
  'paywall.completePurchase': 'Terminer votre achat',
  'paywall.unlock': 'Saisie intelligente illimitée · 5 $/an',
  'paywall.signInHint':
    "Connectez-vous d'abord avec Google — votre licence est enregistrée sur votre compte et restaurée sur n'importe quel appareil.",
  'paywall.resetMidnight':
    'Les saisies gratuites repartent à minuit. La saisie manuelle fonctionne toujours, avec ou sans licence.',
  'paywall.purchaseFailed': "Cet achat n'a pas pu être finalisé. Contactez le propriétaire de l'app si le paiement a été débité.",
  'paywall.unreachable': 'Impossible de joindre le service de licences. Vérifiez votre connexion et réessayez.',
  'paywall.checkoutMissing': "Le lien de paiement n'est pas encore configuré dans cette version. Contactez le propriétaire de l'app.",
  'cats.categories': 'Catégories',
  'cats.expenses': 'Dépenses',
  'cats.income': 'Revenus',
  'cats.addCategory': '+ Ajouter une catégorie',
  'cats.newCategory': 'Nouvelle catégorie',
  'cats.editCategory': 'Modifier la catégorie',
  'cats.deleteCategoryTitle': 'Supprimer la catégorie ?',
  'cats.deleteReassign': 'Les transactions de « {from} » seront déplacées vers « {to} ». Son budget (le cas échéant) est supprimé.',
  'cats.deleteSimple': 'Cette catégorie sera supprimée.',
  'cats.archived': 'archivée',
  'cats.deleteAria': 'Supprimer {name}',
  'cats.name': 'Nom',
  'cats.namePlaceholder': 'p. ex. Animaux',
  'cats.emoji': 'Emoji',
  'cats.typeAria': 'Type de catégorie',
  'cats.addCat': 'Ajouter la catégorie',
  'cats.errName': 'Donnez un nom à la catégorie.',
  'cats.errEmoji': 'Choisissez un emoji pour la catégorie.',
  'seed.housing': 'Logement',
  'seed.utilities': 'Services',
  'seed.groceries': 'Courses',
  'seed.transport': 'Transport',
  'seed.health': 'Santé',
  'seed.education': 'Éducation',
  'seed.entertainment': 'Divertissement',
  'seed.restaurants': 'Restaurants',
  'seed.clothing': 'Vêtements',
  'seed.other': 'Autres',
  'seed.salary': 'Salaire',
  'seed.freelance': 'Freelance',
  'seed.otherIncome': 'Autres revenus',
  'budgets.spentOf': 'dépensés sur',
  'budgets.budgeted': 'budgétés',
  'budgets.left': 'Reste {amount}',
  'budgets.noExpCats': 'Aucune catégorie de dépense',
  'budgets.noExpCatsHint': "Ajoutez d'abord une catégorie de dépense dans l'onglet Catégories.",
  'budgets.withBudgetsAria': 'Catégories avec budget',
  'budgets.withoutBudgetsAria': 'Catégories sans budget',
  'budgets.noLimitYet': 'Pas encore de limite',
  'budgets.setLimit': 'Définir une limite',
  'budgets.spentLabel': '{amount} dépensés',
  'budgets.overBy': 'Dépassement de {amount}',
  'budgets.monthlyLimit': 'Limite mensuelle',
  'budgets.removeLimit': 'Supprimer la limite',
  'budgets.saveLimit': 'Enregistrer la limite',
  'budgets.spentThisPeriod': '{amount} dépensés dans cette catégorie cette période.',
  'budgets.noneThisPeriod': "Aucune dépense dans cette catégorie cette période pour l'instant.",
  'settings.data': 'Données',
  'settings.exportData': 'Exporter les données',
  'settings.exportDesc': 'Téléchargez toutes vos données en JSON.',
  'settings.export': 'Exporter',
  'settings.importData': 'Importer les données',
  'settings.importDesc': 'Remplace les données actuelles par une sauvegarde.',
  'settings.import': 'Importer',
  'settings.resetApp': "Réinitialiser l'app",
  'settings.resetDesc': 'Efface toutes les transactions et les budgets.',
  'settings.reset': 'Réinitialiser',
  'settings.budgetPeriod': 'Période budgétaire',
  'settings.periodStarts': 'La période commence le',
  'settings.periodDesc': "Va de ce jour jusqu'à la veille du même jour le mois suivant.",
  'settings.periodAria': 'Jour de début de période',
  'settings.language': 'Langue',
  'settings.languageAria': "Langue de l'app",
  'settings.about': 'À propos',
  'settings.aboutTitle': 'Suivi de budget personnel.',
  'settings.aboutData': 'Les données restent sur cet appareil — exportez pour sauvegarder.',
  'settings.aboutCurrency': 'Devise : COP, pesos entiers ($ 1.234).',
  'settings.replaceTitle': 'Remplacer toutes les données ?',
  'settings.replaceMsg': "L'import d'une sauvegarde remplace tout le contenu actuel de l'app. Action irréversible.",
  'settings.replaceConfirm': 'Remplacer les données',
  'settings.resetTitle': "Réinitialiser l'app ?",
  'settings.resetMsg':
    "Cela efface TOUTES les transactions, budgets et catégories personnalisées. Exportez d'abord une sauvegarde.",
  'settings.eraseAll': 'Tout effacer',
  'settings.sureTitle': 'Êtes-vous vraiment sûr ?',
  'settings.sureMsg': 'Aucun retour possible. Vos données seront perdues pour toujours.',
  'settings.yesErase': 'Oui, tout effacer',
  'settings.ordinal': { one: '{n}er', other: '{n}e' },
  'license.smartEntry': 'Saisie intelligente',
  'license.unlimited': 'Licence illimitée',
  'license.freePlan': 'Formule gratuite',
  'license.until': "Saisie intelligente illimitée jusqu'au {date}.",
  'license.freeLeft': "{n} saisies gratuites sur {m} aujourd'hui.",
  'license.active': 'Active',
  'license.unlockYear': 'Débloquer · 5 $/an',
  'license.signInUnlock': 'Se connecter pour débloquer',
  'license.purchaseWaiting': 'Achat en attente',
  'license.finishPurchase': "Terminer un achat qui n'a pas abouti.",
  'license.complete': "Terminer l'achat",
  'license.signInComplete': 'Se connecter pour terminer',
  'license.account': 'Compte',
  'license.signedIn': 'Connecté',
  'license.accountDesc': '{email} — licence enregistrée sur votre compte.',
  'license.accountHint': 'Connectez-vous pour garder votre licence sur vos appareils.',
  'license.signOut': 'Se déconnecter',
  'license.signInGoogle': 'Se connecter avec Google',
  'license.restore': 'Restaurer la licence',
  'license.restoreDesc': 'Récupérez votre licence sur cet appareil.',
  'license.restoreBtn': 'Restaurer',
  'license.haveKey': 'Vous avez une clé de licence ?',
  'license.keyFallback': "Solution de secours si la configuration automatique n'a pas abouti.",
  'license.pasteKey': 'Collez la clé de licence',
  'license.keyAria': 'Clé de licence',
  'license.activate': 'Activer',
  'license.working': 'Traitement…',
  'license.activeNote': 'Licence active ✓ — saisie intelligente illimitée.',
  'license.lostNote': 'Licence plus valide — retour à la formule gratuite.',
  'license.noLicense': 'Aucune licence trouvée pour ce compte.',
  'license.verifyFailed': "La connexion n'a pas pu être vérifiée. Déconnectez-vous puis reconnectez-vous.",
  'license.signInFirst': "Connectez-vous d'abord — les licences sont liées à votre compte.",
  'license.badKey': "Cette clé n'est pas valide. Vérifiez-la et réessayez.",
  'parse.notConfigured':
    "La saisie intelligente n'est pas configurée dans cette version. Demandez au propriétaire de l'app de terminer la configuration.",
  'parse.nothing': 'Rien à analyser pour le moment.',
  'parse.unreachable': "Impossible de joindre le service d'analyse. Vérifiez votre connexion et réessayez.",
  'parse.licenseGone': "Votre licence n'est plus valide. Vérifiez-la dans Réglages — la saisie manuelle fonctionne toujours.",
  'parse.licenseLimit': 'Vous avez atteint la limite de saisies intelligentes du jour — elle repart à minuit.',
  'parse.busy': "Le service d'analyse est occupé pour le moment. Réessayez dans un instant.",
  'parse.trouble': "Le service d'analyse rencontre des difficultés. Réessayez bientôt.",
  'parse.unexpected': "Le service d'analyse a répondu de façon inattendue. Réessayez bientôt.",
  'parse.unclear': "Je n'ai pas compris. Reformulez, ou saisissez manuellement.",
  'licensing.unexpected': 'Le service de licences a répondu de façon inattendue. Réessayez bientôt.',
  'licensing.emailMismatch':
    'Cet achat appartient à un autre e-mail — connectez-vous avec le compte Google utilisé au paiement.',
  'licensing.rateLimited': 'Trop de tentatives en peu de temps. Patientez quelques minutes et réessayez.',
  'licensing.notPaid': "Votre paiement n'est pas encore confirmé. Réessayez dans un instant.",
  'licensing.refunded': "Cet achat a été remboursé, aucune licence n'a été émise.",
  'licensing.notFound': "Cette référence d'achat est introuvable. Si le paiement a été débité, contactez le propriétaire de l'app.",
  'licensing.unauthorized': "Le service de licences a rejeté la demande. Vérifiez la configuration de l'app.",
  'licensing.notConfigured': "Le service de licences n'est pas encore prêt — le propriétaire de l'app s'en occupe. Réessayez bientôt.",
  'licensing.serverError': 'Erreur serveur : {reason}',
  'licensing.unreachable': 'Impossible de joindre le service de licences. Vérifiez votre connexion et réessayez.',
  'licensing.verifyFailed': "La connexion n'a pas pu être vérifiée. Déconnectez-vous puis reconnectez-vous.",
  'licensing.signInRequired': "Connectez-vous d'abord avec Google — les licences sont liées à votre compte.",
  'licensing.keyEmailMismatch':
    'Cette clé appartient à un autre e-mail — connectez-vous avec le compte Google utilisé au paiement.',
};

/* ------------------------------------------------------------------ */
/* Portuguese (pt)                                                     */
/* ------------------------------------------------------------------ */

const pt: Dict = {
  close: 'Fechar',
  'tabs.cashFlow': 'Fluxo de caixa',
  'tabs.budgets': 'Orçamentos',
  'tabs.categories': 'Categorias',
  'tabs.settings': 'Configurações',
  'tabs.mainNav': 'Navegação principal',
  'tabs.addTransaction': 'Adicionar transação',
  'nav.prevPeriod': 'Período anterior',
  'nav.nextPeriod': 'Próximo período',
  'nav.jumpToToday': 'Ir para hoje',
  'dashboard.cashFlow': 'Fluxo de caixa:',
  'dashboard.transactions': 'Transações:',
  'dashboard.income': 'Receitas',
  'dashboard.expenses': 'Despesas',
  'dashboard.balance': 'Saldo',
  'dashboard.periodSummary': 'Resumo do período',
  'dashboard.txList': 'Transações',
  'dashboard.noTxTitle': 'Nenhuma transação neste período',
  'dashboard.noTxHintBefore': 'Toque em ',
  'dashboard.noTxHintAfter': ' para registrar uma receita ou despesa.',
  'dashboard.tellMe': 'Me diga qual é a transação:',
  'dashboard.editTx': 'Editar transação',
  'tx.typeAria': 'Tipo de transação',
  'tx.transaction': 'transação',
  'tx.expense': 'Despesa',
  'tx.income': 'Receita',
  'tx.amount': 'Valor',
  'tx.category': 'Categoria',
  'tx.pickCategory': '— Escolha uma categoria —',
  'tx.date': 'Data',
  'tx.note': 'Nota (opcional)',
  'tx.saveChanges': 'Salvar alterações',
  'tx.addTx': 'Adicionar transação',
  'tx.deleteTx': 'Excluir transação',
  'tx.deleteTxTitle': 'Excluir transação?',
  'tx.deleteTxMsg': 'Isso remove a transação permanentemente.',
  'tx.errAmount': 'Informe um valor válido maior que zero.',
  'tx.errCategory': 'Escolha uma categoria.',
  'tx.errDate': 'Escolha uma data.',
  'tx.amountBad': 'Valor inválido',
  'tx.amountZero': 'O valor deve ser maior que zero',
  'smart.submit': 'Enviar',
  'smart.submitting': 'Enviando…',
  'smart.retrying': 'Tentando de novo…',
  'smart.manualInstead': 'Prefiro digitar manualmente',
  'smart.placeholder': 'Use o microfone do seu teclado 🎤',
  'smart.describe': 'Descreva a transação',
  'smart.smartInstead': '⚡ Usar entrada inteligente',
  'smart.errEmpty': 'Primeiro me diga o que você gastou.',
  'smart.unsureOne': 'Só tenho {pct}% de certeza desta — confira os detalhes. Nada foi salvo ainda.',
  'smart.unsureMany': 'Só tenho {pct}% de certeza desta ({pos} de {total}) — confira os detalhes. Nada foi salvo ainda.',
  'smart.almostOne': 'Quase lá — escolha os detalhes que faltam. Nada foi salvo ainda.',
  'smart.almostMany': 'Quase lá — {pos} de {total} precisam de detalhes. Nada foi salvo ainda.',
  'smart.saveNext': 'Salvar e continuar',
  'smart.skip': 'Pular esta',
  'smart.backToText': 'Voltar ao texto',
  'smart.cancel': 'Cancelar',
  'smart.recorded': 'Registrado ✓ — precisa mudar algo? Abra a lista e toque em qualquer transação para editá-la.',
  'smart.spentReceived': 'Gasto / Recebido',
  'smart.total': 'Total',
  'smart.done': 'Concluir',
  'smart.recordMore': 'Registrar mais',
  'smart.addedOne': 'Adicionada: {name} · {amount}',
  'smart.addedBatch': {
    one: '{n} transação adicionada · {amount}',
    other: '{n} transações adicionadas · {amount}',
  },
  'smart.addedBatchNoAmount': { one: '{n} transação adicionada', other: '{n} transações adicionadas' },
  'smart.addedSimple': 'Adicionado · {amount}',
  'paywall.title': 'Você usou as entradas inteligentes gratuitas de hoje',
  'paywall.body':
    'A entrada inteligente é gratuita para {n} análises por dia. Tenha entrada inteligente ilimitada por um ano inteiro — US$ 5.',
  'paywall.signingIn': 'Entrando…',
  'paywall.signInToUnlock': 'Entre com o Google para desbloquear',
  'paywall.completing': 'Concluindo a compra…',
  'paywall.opening': 'Abrindo o pagamento…',
  'paywall.completePurchase': 'Concluir sua compra',
  'paywall.unlock': 'Entrada inteligente ilimitada · US$ 5/ano',
  'paywall.signInHint':
    'Primeiro entre com o Google — sua licença fica salva na sua conta e é restaurada em qualquer dispositivo ou reinstalação.',
  'paywall.resetMidnight':
    'As entradas gratuitas reiniciam à meia-noite. A entrada manual sempre funciona, com ou sem licença.',
  'paywall.purchaseFailed': 'Não foi possível concluir essa compra. Fale com o dono do app se o pagamento foi feito.',
  'paywall.unreachable': 'Não foi possível acessar o serviço de licenças. Verifique sua conexão e tente de novo.',
  'paywall.checkoutMissing': 'O link de pagamento ainda não está configurado nesta versão. Fale com o dono do app.',
  'cats.categories': 'Categorias',
  'cats.expenses': 'Despesas',
  'cats.income': 'Receitas',
  'cats.addCategory': '+ Adicionar categoria',
  'cats.newCategory': 'Nova categoria',
  'cats.editCategory': 'Editar categoria',
  'cats.deleteCategoryTitle': 'Excluir categoria?',
  'cats.deleteReassign': 'As transações de «{from}» serão movidas para «{to}». O orçamento dela (se houver) é removido.',
  'cats.deleteSimple': 'Esta categoria será removida.',
  'cats.archived': 'arquivada',
  'cats.deleteAria': 'Excluir {name}',
  'cats.name': 'Nome',
  'cats.namePlaceholder': 'ex.: Animais',
  'cats.emoji': 'Emoji',
  'cats.typeAria': 'Tipo de categoria',
  'cats.addCat': 'Adicionar categoria',
  'cats.errName': 'Dê um nome à categoria.',
  'cats.errEmoji': 'Escolha um emoji para a categoria.',
  'seed.housing': 'Moradia',
  'seed.utilities': 'Serviços',
  'seed.groceries': 'Mercado',
  'seed.transport': 'Transporte',
  'seed.health': 'Saúde',
  'seed.education': 'Educação',
  'seed.entertainment': 'Entretenimento',
  'seed.restaurants': 'Restaurantes',
  'seed.clothing': 'Roupas',
  'seed.other': 'Outros',
  'seed.salary': 'Salário',
  'seed.freelance': 'Freelance',
  'seed.otherIncome': 'Outras receitas',
  'budgets.spentOf': 'gastos de',
  'budgets.budgeted': 'orçados',
  'budgets.left': 'Restam {amount}',
  'budgets.noExpCats': 'Nenhuma categoria de despesa',
  'budgets.noExpCatsHint': 'Primeiro adicione uma categoria de despesa na aba Categorias.',
  'budgets.withBudgetsAria': 'Categorias com orçamento',
  'budgets.withoutBudgetsAria': 'Categorias sem orçamento',
  'budgets.noLimitYet': 'Ainda sem limite',
  'budgets.setLimit': 'Definir um limite',
  'budgets.spentLabel': '{amount} gastos',
  'budgets.overBy': 'Acima do orçamento em {amount}',
  'budgets.monthlyLimit': 'Limite mensal',
  'budgets.removeLimit': 'Remover limite',
  'budgets.saveLimit': 'Salvar limite',
  'budgets.spentThisPeriod': '{amount} gastos nesta categoria neste período.',
  'budgets.noneThisPeriod': 'Ainda não há gastos nesta categoria neste período.',
  'settings.data': 'Dados',
  'settings.exportData': 'Exportar dados',
  'settings.exportDesc': 'Baixe todos os seus dados em JSON.',
  'settings.export': 'Exportar',
  'settings.importData': 'Importar dados',
  'settings.importDesc': 'Substitui os dados atuais por um backup.',
  'settings.import': 'Importar',
  'settings.resetApp': 'Redefinir app',
  'settings.resetDesc': 'Apaga todas as transações e orçamentos.',
  'settings.reset': 'Redefinir',
  'settings.budgetPeriod': 'Período do orçamento',
  'settings.periodStarts': 'O período começa no dia',
  'settings.periodDesc': 'Vai deste dia até o dia anterior no mês seguinte.',
  'settings.periodAria': 'Dia de início do período',
  'settings.language': 'Idioma',
  'settings.languageAria': 'Idioma do app',
  'settings.about': 'Sobre',
  'settings.aboutTitle': 'Controle de orçamento pessoal.',
  'settings.aboutData': 'Seus dados ficam neste dispositivo — exporte para fazer backup.',
  'settings.aboutCurrency': 'Moeda: COP, pesos inteiros ($ 1.234).',
  'settings.replaceTitle': 'Substituir todos os dados?',
  'settings.replaceMsg': 'Importar um backup substitui tudo o que está no app. Isso não pode ser desfeito.',
  'settings.replaceConfirm': 'Substituir dados',
  'settings.resetTitle': 'Redefinir o app?',
  'settings.resetMsg':
    'Isso apaga TODAS as transações, orçamentos e categorias personalizadas. Exporte um backup antes.',
  'settings.eraseAll': 'Apagar tudo',
  'settings.sureTitle': 'Tem certeza absoluta?',
  'settings.sureMsg': 'Não há como desfazer. Seus dados serão perdidos para sempre.',
  'settings.yesErase': 'Sim, apagar tudo',
  'settings.ordinal': { other: '{n}º' },
  'license.smartEntry': 'Entrada inteligente',
  'license.unlimited': 'Licença ilimitada',
  'license.freePlan': 'Plano gratuito',
  'license.until': 'Entrada inteligente ilimitada até {date}.',
  'license.freeLeft': '{n} de {m} entradas gratuitas hoje.',
  'license.active': 'Ativa',
  'license.unlockYear': 'Desbloquear · US$ 5/ano',
  'license.signInUnlock': 'Entre para desbloquear',
  'license.purchaseWaiting': 'Compra pendente',
  'license.finishPurchase': 'Conclua uma compra que não terminou.',
  'license.complete': 'Concluir compra',
  'license.signInComplete': 'Entre para concluir',
  'license.account': 'Conta',
  'license.signedIn': 'Conectado',
  'license.accountDesc': '{email} — licença salva na sua conta.',
  'license.accountHint': 'Entre para manter sua licença em outros dispositivos.',
  'license.signOut': 'Sair',
  'license.signInGoogle': 'Entrar com o Google',
  'license.restore': 'Restaurar licença',
  'license.restoreDesc': 'Recupere sua licença neste dispositivo.',
  'license.restoreBtn': 'Restaurar',
  'license.haveKey': 'Tem uma chave de licença?',
  'license.keyFallback': 'Alternativa caso a configuração automática não tenha terminado.',
  'license.pasteKey': 'Cole a chave de licença',
  'license.keyAria': 'Chave de licença',
  'license.activate': 'Ativar',
  'license.working': 'Trabalhando…',
  'license.activeNote': 'Licença ativa ✓ — a entrada inteligente é ilimitada.',
  'license.lostNote': 'A licença não é mais válida — a entrada inteligente volta ao plano gratuito.',
  'license.noLicense': 'Nenhuma licença encontrada para esta conta.',
  'license.verifyFailed': 'Não foi possível verificar o login. Saia e entre de novo.',
  'license.signInFirst': 'Entre primeiro — as licenças são vinculadas à sua conta.',
  'license.badKey': 'Essa chave não é válida. Confira e tente de novo.',
  'parse.notConfigured':
    'A entrada inteligente não está configurada nesta versão. Peça ao dono do app para terminar a configuração.',
  'parse.nothing': 'Ainda não há nada para analisar.',
  'parse.unreachable': 'Não foi possível acessar o serviço de análise. Verifique sua conexão e tente de novo.',
  'parse.licenseGone': 'Sua licença não é mais válida. Verifique em Configurações — a entrada manual continua funcionando.',
  'parse.licenseLimit': 'Você atingiu o limite de entradas inteligentes de hoje — ele reinicia à meia-noite.',
  'parse.busy': 'O serviço de análise está ocupado agora. Tente de novo em instantes.',
  'parse.trouble': 'O serviço de análise está com problemas. Tente de novo em breve.',
  'parse.unexpected': 'O serviço de análise respondeu de forma inesperada. Tente de novo em breve.',
  'parse.unclear': 'Não consegui entender. Tente reformular ou digite manualmente.',
  'licensing.unexpected': 'O serviço de licenças respondeu de forma inesperada. Tente de novo em breve.',
  'licensing.emailMismatch': 'Esta compra pertence a outro e-mail — entre com a conta do Google usada no pagamento.',
  'licensing.rateLimited': 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  'licensing.notPaid': 'Seu pagamento ainda não foi confirmado. Tente de novo em instantes.',
  'licensing.refunded': 'Essa compra foi reembolsada, então nenhuma licença foi emitida.',
  'licensing.notFound': 'Essa referência de compra não foi encontrada. Se o pagamento foi feito, fale com o dono do app.',
  'licensing.unauthorized': 'O serviço de licenças rejeitou a solicitação. Verifique a configuração do app.',
  'licensing.notConfigured': 'O serviço de licenças ainda não está pronto — o dono do app está cuidando disso. Tente de novo em breve.',
  'licensing.serverError': 'Erro do servidor: {reason}',
  'licensing.unreachable': 'Não foi possível acessar o serviço de licenças. Verifique sua conexão e tente de novo.',
  'licensing.verifyFailed': 'Não foi possível verificar o login. Saia e entre de novo.',
  'licensing.signInRequired': 'Entre primeiro com o Google — as licenças são vinculadas à sua conta.',
  'licensing.keyEmailMismatch': 'Esta chave pertence a outro e-mail — entre com a conta do Google usada no pagamento.',
};

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

const dictionaries: Partial<Record<Lang, Dict>> = { en: en as Dict, es, fr, pt };
// Branch 2 adds zh, hi, bn, ru, ur, ar.

/** All message keys (for tests/diagnostics). */
export function catalogKeys(): MsgKey[] {
  return Object.keys(en) as MsgKey[];
}

/** Raw catalogs (for tests/diagnostics — prefer t() in app code). */
export const catalogs = dictionaries;

const STORAGE_KEY = 'budget.language';

let current: Lang = readInitial();
const listeners = new Set<() => void>();

/** First run: match the device language when we ship it; otherwise English. */
function detect(): Lang {
  try {
    const nav = (typeof navigator !== 'undefined' && navigator.languages?.[0]) || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';
    const base = nav.split('-')[0].toLowerCase();
    if (base in dictionaries) return base as Lang;
  } catch {
    /* fall through */
  }
  return 'en';
}

function readInitial(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in dictionaries) return stored as Lang;
  } catch {
    /* storage unavailable — detect only */
  }
  return detect();
}

/** Languages that actually ship a catalog (grows in branch 2). */
export function availableLanguages(): Lang[] {
  return (Object.keys(dictionaries) as Lang[]).sort();
}

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang): void {
  if (!(lang in dictionaries) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  applyDocumentLanguage();
  for (const cb of listeners) cb();
}

export function subscribeI18n(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Keep <html lang/dir> in sync (RTL for ar/ur). */
export function applyDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  const meta = LANGS[current];
  document.documentElement.lang = meta.intl;
  document.documentElement.dir = meta.dir;
}

/** React snapshot: re-renders the component when the language changes. */
export function useI18n(): { lang: Lang; dir: 'ltr' | 'rtl'; intl: string; money: LangMeta['money'] } {
  const lang = useSyncExternalStore(subscribeI18n, () => current);
  const meta = LANGS[lang];
  return { lang, dir: meta.dir, intl: meta.intl, money: meta.money };
}

function pickPlural(entry: Exclude<Phrase, string>, n: number): string {
  let cat = 'other';
  try {
    cat = new Intl.PluralRules(LANGS[current].intl).select(n);
  } catch {
    /* fall back to other */
  }
  return entry[cat as keyof typeof entry] ?? entry.other ?? entry.one ?? '';
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

/** Translate a catalog key for the CURRENT language (falls back to en). */
export function t(key: MsgKey, params?: Record<string, string | number>): string {
  const entry = dictionaries[current]?.[key] ?? (en[key] as Phrase);
  if (typeof entry === 'string') return interpolate(entry, params);
  return interpolate(pickPlural(entry, Number(params?.n ?? 1)), params);
}

/** Ordinal day number for the period picker ("1st", "2º", "2e"…). */
export function to(n: number): string {
  const entry = (dictionaries[current]?.['settings.ordinal'] ?? en['settings.ordinal']) as Phrase;
  if (typeof entry === 'string') return interpolate(entry, { n });
  let cat = 'other';
  try {
    cat = new Intl.PluralRules(LANGS[current].intl, { type: 'ordinal' }).select(n);
  } catch {
    /* fall back to other */
  }
  return interpolate(entry[cat as keyof typeof entry] ?? entry.other ?? String(n), { n });
}
