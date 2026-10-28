import type { FormEvent } from "react";
import { ChevronRight, X } from "lucide-react";
import { games } from "../lib/constants";

type GameModalProps = {
  activeGame: string;
  gameNotice: string;
  chessSolved: boolean;
  unoHand: string[];
  unoTop: string;
  baldaInput: string;
  baldaWords: string[];
  baldaScore: number;
  onClose: () => void;
  onOpenGame: (name: string) => void;
  onPlayUno: (card: string) => void;
  onDrawUno: () => void;
  onChessAnswer: (answer: string) => void;
  onBaldaInput: (value: string) => void;
  onBaldaSubmit: (event: FormEvent) => void;
};

const UNO_COLORS: Record<string, string> = { "🔴": "red", "🔵": "blue", "🟡": "yellow", "🟢": "green" };

export default function GameModal({
  activeGame,
  gameNotice,
  chessSolved,
  unoHand,
  unoTop,
  baldaInput,
  baldaWords,
  baldaScore,
  onClose,
  onOpenGame,
  onPlayUno,
  onDrawUno,
  onChessAnswer,
  onBaldaInput,
  onBaldaSubmit,
}: GameModalProps) {
  return (
    <div className="modal-backdrop game-backdrop" onClick={onClose}>
      <section className="game-modal" onClick={(event) => event.stopPropagation()}>
        <header className="game-modal-header">
          <div>
            <span className="game-modal-eyebrow">NEXUS ARCADE</span>
            <h2>{activeGame === "Каталог" ? "Мини-игры" : activeGame}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть игры">
            <X size={20} />
          </button>
        </header>

        {activeGame === "Каталог" && (
          <div className="game-picker">
            {games.map((game) => (
              <button key={game.name} className="game-picker-card" onClick={() => onOpenGame(game.name)}>
                <span className={`game-icon ${game.cls}`}>{game.icon}</span>
                <strong>{game.name}</strong>
                <small>{game.desc}</small>
                <span className="game-play-label">
                  Играть <ChevronRight size={15} />
                </span>
              </button>
            ))}
          </div>
        )}

        {activeGame === "Шахматы" && (
          <div className="chess-game">
            <p className="game-instructions">Шахматная разминка: белые ходят. Как лучше продолжить позицию?</p>
            <div className="chess-board" aria-label="Шахматная доска">
              {["♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜", ...Array(8).fill("♟"), ...Array(32).fill(""), ...Array(8).fill("♙"), "♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"].map((piece, index) => (
                <div key={index} className={`chess-square ${(Math.floor(index / 8) + (index % 8)) % 2 === 0 ? "light" : "dark"}`}>
                  {piece}
                </div>
              ))}
            </div>
            <strong className="game-question">Как называется ход, который одновременно атакует короля?</strong>
            <div className="chess-answers">
              {["Рокировка", "Шах", "Пат"].map((answer) => (
                <button key={answer} onClick={() => onChessAnswer(answer)}>
                  {answer}
                </button>
              ))}
            </div>
            {chessSolved && (
              <button className="game-secondary" onClick={() => onChessAnswer("")}>
                Попробовать ещё раз
              </button>
            )}
          </div>
        )}

        {activeGame === "Uno" && (
          <div className="uno-game">
            <p className="game-instructions">Сыграй карту того же цвета или числа, что и верхняя карта. Соперник виртуальный.</p>
            <div className="uno-table">
              <span>Карта на столе</span>
              <div className="uno-card top-card">{unoTop}</div>
              <small>Карт у тебя: {unoHand.length}</small>
            </div>
            <strong className="game-question">Твои карты</strong>
            <div className="uno-hand">
              {unoHand.map((card, index) => (
                <button key={card + index} className={`uno-card card-${UNO_COLORS[card.slice(0, 2)] ?? "green"}`} onClick={() => onPlayUno(card)}>
                  {card}
                </button>
              ))}
            </div>
            <button className="game-secondary" onClick={onDrawUno}>
              Взять карту +1
            </button>
          </div>
        )}

        {activeGame === "Балда" && (
          <div className="balda-game">
            <p className="game-instructions">Составляй русские слова. Каждое новое слово приносит очки по числу букв. Это локальная тренировка.</p>
            <div className="balda-board">
              {["Б", "А", "Л", "Д", "А"].map((letter, index) => (
                <span key={index}>{letter}</span>
              ))}
            </div>
            <div className="balda-score">
              <span>Твои очки</span>
              <strong>{baldaScore}</strong>
              <small>слов: {baldaWords.length}</small>
            </div>
            <form className="balda-form" onSubmit={onBaldaSubmit}>
              <input value={baldaInput} onChange={(event) => onBaldaInput(event.target.value)} placeholder="Введи слово..." maxLength={20} />
              <button type="submit">Добавить</button>
            </form>
            {baldaWords.length > 0 && (
              <div className="balda-words">
                {baldaWords.map((word) => (
                  <span key={word}>
                    {word} <b>+{word.length}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {gameNotice && (
          <div className="game-feedback" role="status">
            {gameNotice}
          </div>
        )}
        {activeGame !== "Каталог" && (
          <button className="game-back-link" onClick={() => onOpenGame("Каталог")}>
            ← Все мини-игры
          </button>
        )}
      </section>
    </div>
  );
}
