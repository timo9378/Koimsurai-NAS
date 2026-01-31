'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Delete, Divide, X, Minus, Plus, Equal, Percent } from 'lucide-react';

interface CalculatorProps {
  windowId?: string;
}

type Operation = '+' | '-' | '×' | '÷' | '%' | null;

export const Calculator = ({ windowId }: CalculatorProps) => {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [history, setHistory] = useState<string>('');

  const clearAll = useCallback(() => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setWaitingForOperand(false);
    setHistory('');
  }, []);

  const clearEntry = useCallback(() => {
    setDisplay('0');
    setWaitingForOperand(false);
  }, []);

  const toggleSign = useCallback(() => {
    const value = parseFloat(display);
    setDisplay(String(-value));
  }, [display]);

  const inputPercent = useCallback(() => {
    const value = parseFloat(display);
    setDisplay(String(value / 100));
  }, [display]);

  const inputDigit = useCallback((digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  }, [display, waitingForOperand]);

  const inputDot = useCallback(() => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }

    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  }, [display, waitingForOperand]);

  const performOperation = useCallback((nextOperation: Operation) => {
    const inputValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(inputValue);
      setHistory(`${display} ${nextOperation}`);
    } else if (operation) {
      const currentValue = previousValue;
      let result: number;

      switch (operation) {
        case '+':
          result = currentValue + inputValue;
          break;
        case '-':
          result = currentValue - inputValue;
          break;
        case '×':
          result = currentValue * inputValue;
          break;
        case '÷':
          result = inputValue !== 0 ? currentValue / inputValue : NaN;
          break;
        default:
          result = inputValue;
      }

      // Format result to avoid floating point issues
      const formattedResult = Number.isFinite(result) 
        ? parseFloat(result.toPrecision(12)).toString()
        : 'Error';

      setDisplay(formattedResult);
      setPreviousValue(formattedResult === 'Error' ? null : parseFloat(formattedResult));
      setHistory(nextOperation ? `${formattedResult} ${nextOperation}` : '');
    }

    setWaitingForOperand(true);
    setOperation(nextOperation);
  }, [display, operation, previousValue]);

  const calculate = useCallback(() => {
    if (operation && previousValue !== null) {
      const inputValue = parseFloat(display);
      let result: number;

      switch (operation) {
        case '+':
          result = previousValue + inputValue;
          break;
        case '-':
          result = previousValue - inputValue;
          break;
        case '×':
          result = previousValue * inputValue;
          break;
        case '÷':
          result = inputValue !== 0 ? previousValue / inputValue : NaN;
          break;
        default:
          result = inputValue;
      }

      const formattedResult = Number.isFinite(result) 
        ? parseFloat(result.toPrecision(12)).toString()
        : 'Error';

      setHistory(`${previousValue} ${operation} ${inputValue} =`);
      setDisplay(formattedResult);
      setPreviousValue(null);
      setOperation(null);
      setWaitingForOperand(true);
    }
  }, [display, operation, previousValue]);

  const handleBackspace = useCallback(() => {
    if (waitingForOperand) return;
    
    if (display.length > 1) {
      setDisplay(display.slice(0, -1));
    } else {
      setDisplay('0');
    }
  }, [display, waitingForOperand]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      if (/^[0-9]$/.test(key)) {
        inputDigit(key);
      } else if (key === '.') {
        inputDot();
      } else if (key === '+') {
        performOperation('+');
      } else if (key === '-') {
        performOperation('-');
      } else if (key === '*') {
        performOperation('×');
      } else if (key === '/') {
        e.preventDefault();
        performOperation('÷');
      } else if (key === '%') {
        inputPercent();
      } else if (key === 'Enter' || key === '=') {
        e.preventDefault();
        calculate();
      } else if (key === 'Backspace') {
        handleBackspace();
      } else if (key === 'Escape') {
        clearAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputDigit, inputDot, performOperation, inputPercent, calculate, handleBackspace, clearAll]);

  const Button = ({ 
    children, 
    onClick, 
    variant = 'default',
    className 
  }: { 
    children: React.ReactNode; 
    onClick: () => void; 
    variant?: 'default' | 'operator' | 'function' | 'equal';
    className?: string;
  }) => {
    const baseClasses = "flex items-center justify-center rounded-xl font-medium text-xl transition-all duration-150 active:scale-95 select-none";
    
    const variantClasses = {
      default: "bg-[#505050] hover:bg-[#606060] text-white",
      operator: "bg-[#ff9500] hover:bg-[#ffaa33] text-white",
      function: "bg-[#a5a5a5] hover:bg-[#b5b5b5] text-black",
      equal: "bg-[#ff9500] hover:bg-[#ffaa33] text-white",
    };

    return (
      <button
        onClick={onClick}
        className={cn(baseClasses, variantClasses[variant], className)}
      >
        {children}
      </button>
    );
  };

  // Format display number
  const formatDisplay = (value: string) => {
    if (value === 'Error') return value;
    
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    
    // Handle very long numbers
    if (value.length > 12) {
      return num.toExponential(6);
    }
    
    // Add thousand separators for whole part
    const parts = value.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#2c2c2e] to-[#1c1c1e] p-4 rounded-lg">
      {/* Display */}
      <div className="flex-shrink-0 mb-4">
        {/* History */}
        <div className="h-6 text-right text-gray-500 text-sm font-light px-2 truncate">
          {history}
        </div>
        {/* Main Display */}
        <div className="h-20 flex items-end justify-end px-2">
          <span 
            className={cn(
              "text-white font-light tracking-tight transition-all",
              display.length > 9 ? "text-3xl" : display.length > 7 ? "text-4xl" : "text-5xl"
            )}
          >
            {formatDisplay(display)}
          </span>
        </div>
      </div>

      {/* Buttons Grid */}
      <div className="flex-1 grid grid-cols-4 gap-3 min-h-0">
        {/* Row 1 */}
        <Button variant="function" onClick={clearAll}>AC</Button>
        <Button variant="function" onClick={toggleSign}>±</Button>
        <Button variant="function" onClick={inputPercent}>
          <Percent className="w-5 h-5" />
        </Button>
        <Button variant="operator" onClick={() => performOperation('÷')}>
          <Divide className="w-6 h-6" />
        </Button>

        {/* Row 2 */}
        <Button onClick={() => inputDigit('7')}>7</Button>
        <Button onClick={() => inputDigit('8')}>8</Button>
        <Button onClick={() => inputDigit('9')}>9</Button>
        <Button variant="operator" onClick={() => performOperation('×')}>
          <X className="w-6 h-6" />
        </Button>

        {/* Row 3 */}
        <Button onClick={() => inputDigit('4')}>4</Button>
        <Button onClick={() => inputDigit('5')}>5</Button>
        <Button onClick={() => inputDigit('6')}>6</Button>
        <Button variant="operator" onClick={() => performOperation('-')}>
          <Minus className="w-6 h-6" />
        </Button>

        {/* Row 4 */}
        <Button onClick={() => inputDigit('1')}>1</Button>
        <Button onClick={() => inputDigit('2')}>2</Button>
        <Button onClick={() => inputDigit('3')}>3</Button>
        <Button variant="operator" onClick={() => performOperation('+')}>
          <Plus className="w-6 h-6" />
        </Button>

        {/* Row 5 */}
        <Button onClick={() => inputDigit('0')} className="col-span-2">0</Button>
        <Button onClick={inputDot}>.</Button>
        <Button variant="equal" onClick={calculate}>
          <Equal className="w-6 h-6" />
        </Button>
      </div>

      {/* Keyboard Hints */}
      <div className="mt-3 text-center text-xs text-gray-600">
        Keyboard: 0-9, +, -, *, /, Enter, Esc
      </div>
    </div>
  );
};
