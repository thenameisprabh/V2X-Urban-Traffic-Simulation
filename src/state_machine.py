"""
FSM Base Class
"""

from enum import Enum
from typing import Dict, Callable, Optional

class AgentState(Enum):
    """Base agent states"""
    IDLE = "idle"

class StateMachine:
    """Finite State Machine for agent behavior"""
    
    def __init__(self, initial_state: AgentState):
        self.current_state = initial_state
        self.transitions: Dict[tuple, Callable] = {}
        self.on_enter_callbacks: Dict[AgentState, Callable] = {}
        self.on_exit_callbacks: Dict[AgentState, Callable] = {}
        self.state_history = [initial_state]
    
    def add_transition(self, from_state: AgentState, to_state: AgentState, condition: Callable) -> 'StateMachine':
        """Add state transition"""
        self.transitions[(from_state, to_state)] = condition
        return self
    
    def on_enter(self, state: AgentState, callback: Callable) -> 'StateMachine':
        """Register entry callback"""
        self.on_enter_callbacks[state] = callback
        return self
    
    def on_exit(self, state: AgentState, callback: Callable) -> 'StateMachine':
        """Register exit callback"""
        self.on_exit_callbacks[state] = callback
        return self
    
    def update(self, context: Dict) -> bool:
        """Update FSM - returns True if state changed"""
        for (from_state, to_state), condition in self.transitions.items():
            if from_state == self.current_state:
                try:
                    if condition(context):
                        self.transition_to(to_state)
                        return True
                except Exception as e:
                    print(f"❌ Transition error: {e}")
        
        return False
    
    def transition_to(self, new_state: AgentState):
        """Transition to new state"""
        if new_state == self.current_state:
            return
        
        if self.current_state in self.on_exit_callbacks:
            try:
                self.on_exit_callbacks[self.current_state]()
            except Exception as e:
                print(f"❌ Exit callback error: {e}")
        
        self.current_state = new_state
        if new_state in self.on_enter_callbacks:
            try:
                self.on_enter_callbacks[new_state]()
            except Exception as e:
                print(f"❌ Enter callback error: {e}")
        
        self.state_history.append(new_state)
    
    def get_state(self) -> AgentState:
        return self.current_state
    
    def get_state_name(self) -> str:
        return self.current_state.value
