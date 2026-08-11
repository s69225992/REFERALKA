import { redirect } from "next/navigation";

// Стартовая страница ведёт в кабинет (утверждённый прототип в public/cabinet.html).
// Позже кабинет будет тянуть живые данные из API-роутов.
export default function Home() {
  redirect("/cabinet.html");
}
