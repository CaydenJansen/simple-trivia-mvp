import { notFound } from "next/navigation";
import PlayerPrototype from "../../../components/player/PlayerPrototype";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PlayerPrototype />;
}
