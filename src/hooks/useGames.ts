import { useState } from "react";
import type { FormEvent } from "react";

export function useGames() {
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [gameNotice, setGameNotice] = useState("");
  const [chessSolved, setChessSolved] = useState(false);
  const [unoHand, setUnoHand] = useState(["🔴 3", "🔵 7", "🟡 2", "🟢 5", "🔴 9"]);
  const [unoTop, setUnoTop] = useState("🔵 4");
  const [baldaInput, setBaldaInput] = useState("");
  const [baldaWords, setBaldaWords] = useState<string[]>([]);
  const [baldaScore, setBaldaScore] = useState(0);

  function openGame(name: string) {
    setActiveGame(name);
    setGameNotice("");
    if (name === "Шахматы") setChessSolved(false);
    if (name === "Uno") {
      setUnoHand(["🔴 3", "🔵 7", "🟡 2", "🟢 5", "🔴 9"]);
      setUnoTop("🔵 4");
    }
    if (name === "Балда") {
      setBaldaInput("");
      setBaldaWords([]);
      setBaldaScore(0);
    }
  }

  function playUnoCard(card: string) {
    const cardColor = card.slice(0, 2);
    const topColor = unoTop.slice(0, 2);
    const cardNumber = card.trim().slice(-1);
    const topNumber = unoTop.trim().slice(-1);
    if (cardColor !== topColor && cardNumber !== topNumber) {
      setGameNotice("Можно положить карту того же цвета или числа.");
      return;
    }
    const nextHand = unoHand.filter((item) => item !== card);
    const colors = ["🔴", "🔵", "🟡", "🟢"];
    const nextCard = `${colors[Math.floor(Math.random() * colors.length)]} ${Math.floor(Math.random() * 9) + 1}`;
    setUnoHand(nextHand);
    setUnoTop(nextCard);
    setGameNotice(nextHand.length === 0 ? "УНО! Ты выиграл раунд 🎉" : "Карта сыграна! Ход виртуального соперника завершён.");
  }

  function drawUnoCard() {
    const colors = ["🔴", "🔵", "🟡", "🟢"];
    const card = `${colors[Math.floor(Math.random() * colors.length)]} ${Math.floor(Math.random() * 9) + 1}`;
    setUnoHand((hand) => [...hand, card]);
    setGameNotice("Ты взял карту. Теперь можно сыграть подходящую.");
  }

  function submitBaldaWord(event: FormEvent) {
    event.preventDefault();
    const word = baldaInput.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
    if (word.length < 3 || !/^[а-я]+$/.test(word)) {
      setGameNotice("Введи русское слово минимум из 3 букв.");
      return;
    }
    if (baldaWords.includes(word)) {
      setGameNotice("Это слово уже использовано.");
      return;
    }
    setBaldaWords((words) => [...words, word]);
    setBaldaScore((score) => score + word.length);
    setBaldaInput("");
    setGameNotice(`Принято: +${word.length} очков!`);
  }

  function answerChess(answer: string) {
    if (!answer) {
      setChessSolved(false);
      setGameNotice("");
      return;
    }
    setChessSolved(true);
    setGameNotice(answer === "Шах" ? "Верно! ♟️ Король под атакой." : "Не совсем. Правильный ответ — «Шах».");
  }

  return {
    activeGame,
    setActiveGame,
    gameNotice,
    chessSolved,
    unoHand,
    unoTop,
    baldaInput,
    baldaWords,
    baldaScore,
    setBaldaInput,
    openGame,
    playUnoCard,
    drawUnoCard,
    submitBaldaWord,
    answerChess,
  };
}
