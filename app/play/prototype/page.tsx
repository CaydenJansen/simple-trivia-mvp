import { headers } from "next/headers";
import { notFound } from "next/navigation";
import PlayerPrototype from "../../../components/player/PlayerPrototype";

export default async function Page() {
  const host = (await headers()).get("host") ?? "";
  const isLocalRequest = host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
  if (process.env.NODE_ENV === "production" && !isLocalRequest) notFound();
  return <PlayerPrototype />;
}
