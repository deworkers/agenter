import type { StoredMessage } from "../api/types.js";

const presentations: Record<NonNullable<StoredMessage["errorCode"]>, { reason: string; nextStep: string }> = {
  cancelled: { reason: "Генерация остановлена.", nextStep: "Отправьте запрос снова, когда будете готовы." },
  timeout: { reason: "Модель не успела ответить за отведённое время.", nextStep: "Проверьте соединение или увеличьте таймаут модели." },
  provider_unavailable: { reason: "Не удалось получить ответ от модели.", nextStep: "Проверьте настройки модели и попробуйте позже." },
  invalid_response: { reason: "Модель вернула пустой или некорректный ответ.", nextStep: "Уточните формат результата или выберите другую модель." },
  context_over_limit: { reason: "Запрос не помещается в контекст модели.", nextStep: "Сократите сообщение, историю или число инструментов." },
  tool_not_allowed: { reason: "Модель запросила недоступный или запрещённый инструмент.", nextStep: "Проверьте выбранные навыки и разрешённые инструменты." },
  tool_failed: { reason: "Инструмент завершился с ошибкой.", nextStep: "Проверьте доступность источника и повторите запрос вручную." },
  tool_unavailable: { reason: "Источник инструмента временно недоступен.", nextStep: "Модель сможет продолжить без него; при необходимости повторите запрос вручную." },
  tool_invalid_result: { reason: "Инструмент вернул результат в неподдерживаемом формате.", nextStep: "Проверьте инструмент и повторите запрос вручную." },
  tool_result_too_large: { reason: "Результат инструмента превышает допустимый размер.", nextStep: "Уточните запрос, чтобы получить меньший результат." },
  incomplete_response: { reason: "Ответ модели оборвался до завершения.", nextStep: "Проверьте соединение и повторите запрос вручную." },
  persistence_failed: { reason: "Не удалось сохранить запуск.", nextStep: "Проверьте свободное место и состояние локальной базы." },
};

export function runErrorPresentation(message: Pick<StoredMessage, "error" | "errorCode">): { reason: string; nextStep?: string } {
  if (message.errorCode) return presentations[message.errorCode];
  return { reason: message.error ?? "Запрос не завершён успешно." };
}
