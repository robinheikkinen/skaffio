from datetime import datetime, date
from typing import Optional
from sqlmodel import SQLModel, Field


class Tag(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    color: str = "#6B7280"


class RecipeTag(SQLModel, table=True):
    recipe_id: Optional[int] = Field(default=None, foreign_key="recipe.id", primary_key=True)
    tag_id: Optional[int] = Field(default=None, foreign_key="tag.id", primary_key=True)


class Recipe(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    description: Optional[str] = None
    ingredients: str  # JSON: [{name, amount, unit}]
    instructions: str  # Markdown
    servings: int = 4
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    source_url: Optional[str] = None
    source_type: str = "manual"  # manual | url | pdf | image | fork
    cover_image: Optional[str] = None
    visibility: str = "private"   # 'public' | 'private'
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")
    # Näringsvärden per portion (valfria)
    calories: Optional[int] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    rating: Optional[int] = None              # 1-5 stjärnor
    times_cooked: int = 0                     # antal gånger lagad
    last_cooked_at: Optional[datetime] = None # "senast lagad"
    share_token: Optional[str] = Field(default=None, unique=True, index=True)
    notes: Optional[str] = None               # familje-anteckningar ("nästa gång mindre salt")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class RecipeImage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: Optional[int] = Field(default=None, foreign_key="recipe.id")
    filename: str
    original_name: str
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)


class ShoppingList(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "Min inköpslista"
    items: str  # JSON: [{name, amount, unit, checked, recipe_id, category}]
    share_token: Optional[str] = Field(default=None, unique=True, index=True)
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MealPlanEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: int = Field(foreign_key="recipe.id")
    date: date
    meal_type: str = "dinner"  # breakfast | lunch | dinner | snack
    servings: int = 4
    notes: Optional[str] = None
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")


class Favorite(SQLModel, table=True):
    """Per-user favoritering av recept."""
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", primary_key=True)
    recipe_id: Optional[int] = Field(default=None, foreign_key="recipe.id", primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Invite(SQLModel, table=True):
    """Admin-skapad inbjudan. När personen loggar in via CF Access och email
    matchar, auto-skapas user med rätt roll. Invites kan revokas innan användning."""
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    role: str = "member"
    invited_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    used_at: Optional[datetime] = None              # när användaren faktiskt loggade in
    used_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    note: Optional[str] = None                       # ex. "Sambo", "Mormor"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Household(SQLModel, table=True):
    """Ett hushåll — den enhet som äger privata recept och delar pantry."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "Familjen"
    invite_code: str = Field(unique=True, index=True)
    school_menu_url: Optional[str] = None
    school_display_name: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str
    password_hash: str
    role: str = "member"          # "admin" | "member"
    is_active: bool = True
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")
    failed_login_attempts: int = 0           # nollställs vid lyckad login
    locked_until: Optional[datetime] = None  # auto-lock efter 5 failed (15 min)
    totp_secret: Optional[str] = None         # Aktivt TOTP-secret (sätts först vid /totp/enable)
    totp_secret_pending: Optional[str] = None # Provisoriskt secret — väntar på verifiering
    totp_enabled: bool = False                # förenklar att visa status utan att läsa secret
    known_ips: Optional[str] = None          # JSON-array av IPs vi sett user logga in från
    ical_token: Optional[str] = None         # Unik iCal-token för kalenderprenumeration
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login_at: Optional[datetime] = None


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    action: str                                  # ex "recipe.create"
    entity_type: Optional[str] = None            # "recipe" | "shopping_list" | …
    entity_id: Optional[int] = None
    details: Optional[str] = None                # JSON-sträng med fri context
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class Collection(SQLModel, table=True):
    """Folders for organizing recipes."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    icon: str = "📁"                  # emoji icon
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RecipeCollection(SQLModel, table=True):
    """Junction table: recipe <-> collection."""
    recipe_id: Optional[int] = Field(default=None, foreign_key="recipe.id", primary_key=True)
    collection_id: Optional[int] = Field(default=None, foreign_key="collection.id", primary_key=True)


class PantryItem(SQLModel, table=True):
    """Skafferi/kyl/frys — vad finns hemma + utgångsdatum."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)             # "Mjölk", "Grädde", "Kyckling"
    amount: Optional[float] = None            # numerisk mängd
    unit: Optional[str] = None                # "dl", "g", "st"
    location: str = "Skafferi"                # se LOCATIONS i Pantry.jsx
    expiry_date: Optional[date] = None        # bäst-före
    notes: Optional[str] = None
    is_staple: bool = False                   # "finns alltid hemma" — påverkar pantry-match
    added_at: datetime = Field(default_factory=datetime.utcnow)
    added_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")


class FreezerPortion(SQLModel, table=True):
    """Färdiga barnportioner (eller vuxenportioner) som sparats i frys/kyl."""
    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: Optional[int] = Field(default=None, foreign_key="recipe.id")
    label: str                        # "Lasagne (barnportion)"
    portions: int = 1
    portion_type: str = "child"       # "child" | "adult"
    location: str = "Frys 1"          # Frys 1 | Frys 2 | Kyl 1 | Kyl 2
    notes: Optional[str] = None
    saved_at: datetime = Field(default_factory=datetime.utcnow)
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")


class CalorieLog(SQLModel, table=True):
    """Logga vad du åt — kopplar till recept och sparar kcal/makros vid loggtillfället."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    household_id: Optional[int] = Field(default=None, foreign_key="household.id", index=True)
    recipe_id: Optional[int] = Field(default=None, foreign_key="recipe.id")
    recipe_title: str                       # denormaliserat — historiken håller sig korrekt
    servings: float = 1.0
    calories: Optional[int] = None          # per portion vid loggtillfället × servings
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    logged_at: datetime = Field(default_factory=datetime.utcnow)
    log_date: date                          # vilken dag loggningen tillhör


class InboxRecipe(SQLModel, table=True):
    """Inkommande recept (via URL/dela) som väntar på granskning innan de läggs i biblioteket."""
    id: Optional[int] = Field(default=None, primary_key=True)
    url: str                                  # källans URL
    title: str = ""
    description: str = ""
    ingredients: str = "[]"                   # JSON: [{name, amount, unit}]
    instructions: str = ""
    servings: Optional[int] = None
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    cover_image: Optional[str] = None         # lokal filename i /data/uploads/
    cover_image_url: Optional[str] = None     # original URL
    raw_markdown: Optional[str] = None        # Firecrawl-output (debug/redigering)
    status: str = "pending"                   # pending | processing | review | approved | rejected | error
    error_message: Optional[str] = None
    approved_recipe_id: Optional[int] = None  # FK till Recipe om godkänd
    household_id: Optional[int] = Field(default=None, foreign_key="household.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
