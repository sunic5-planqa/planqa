from pydantic import BaseModel


class Team(BaseModel):
    team_code: str
    team_name: str
    description: str
