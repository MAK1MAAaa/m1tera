/** Public, unchanged benchmark questions; answers are never passed to the answer agent.
 * Dataset revisions, full-source hashes, sampling and redistribution licenses are in sources.json.
 */
export interface BfclFunction { name: string; description: string; parameters: { type: string; properties: Record<string, Record<string, unknown>>; required: string[] } }
export interface BfclExample { id: string; category: 'simple_python' | 'multiple'; prompt: string; functions: BfclFunction[]; groundTruth: Record<string, Record<string, unknown[]>>[] }
export interface SimpleQaExample { id: string; row: number; prompt: string; answer: string }

export const BFCL_CASES: readonly BfclExample[] = [
  {
    "id": "simple_python_0",
    "category": "simple_python",
    "prompt": "Find the area of a triangle with a base of 10 units and height of 5 units.",
    "functions": [
      {
        "name": "calculate_triangle_area",
        "description": "Calculate the area of a triangle given its base and height.",
        "parameters": {
          "type": "dict",
          "properties": {
            "base": {
              "type": "integer",
              "description": "The base of the triangle."
            },
            "height": {
              "type": "integer",
              "description": "The height of the triangle."
            },
            "unit": {
              "type": "string",
              "description": "The unit of measure (defaults to 'units' if not specified)"
            }
          },
          "required": [
            "base",
            "height"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "calculate_triangle_area": {
          "base": [
            10
          ],
          "height": [
            5
          ],
          "unit": [
            "units",
            ""
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_1",
    "category": "simple_python",
    "prompt": "Calculate the factorial of 5 using math functions.",
    "functions": [
      {
        "name": "math.factorial",
        "description": "Calculate the factorial of a given number.",
        "parameters": {
          "type": "dict",
          "properties": {
            "number": {
              "type": "integer",
              "description": "The number for which factorial needs to be calculated."
            }
          },
          "required": [
            "number"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "math.factorial": {
          "number": [
            5
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_2",
    "category": "simple_python",
    "prompt": "Calculate the hypotenuse of a right triangle given the lengths of the other two sides as 4 and 5.",
    "functions": [
      {
        "name": "math.hypot",
        "description": "Calculate the Euclidean norm, sqrt(sum(squares)), the length of the vector from the origin to point (x, y) which is the hypotenuse of the right triangle.",
        "parameters": {
          "type": "dict",
          "properties": {
            "x": {
              "type": "integer",
              "description": "The x-coordinate value."
            },
            "y": {
              "type": "integer",
              "description": "The y-coordinate value."
            },
            "z": {
              "type": "integer",
              "description": "Optional. The z-coordinate value. Default is 0."
            }
          },
          "required": [
            "x",
            "y"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "math.hypot": {
          "x": [
            4
          ],
          "y": [
            5
          ],
          "z": [
            "",
            0
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_3",
    "category": "simple_python",
    "prompt": "Find the roots of a quadratic equation with coefficients a=1, b=-3, c=2.",
    "functions": [
      {
        "name": "algebra.quadratic_roots",
        "description": "Find the roots of a quadratic equation ax^2 + bx + c = 0.",
        "parameters": {
          "type": "dict",
          "properties": {
            "a": {
              "type": "integer",
              "description": "Coefficient of x^2."
            },
            "b": {
              "type": "integer",
              "description": "Coefficient of x."
            },
            "c": {
              "type": "integer",
              "description": "Constant term."
            }
          },
          "required": [
            "a",
            "b",
            "c"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "algebra.quadratic_roots": {
          "a": [
            1
          ],
          "b": [
            -3
          ],
          "c": [
            2
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_4",
    "category": "simple_python",
    "prompt": "Solve a quadratic equation where a=2, b=6, and c=5",
    "functions": [
      {
        "name": "solve_quadratic_equation",
        "description": "Function solves the quadratic equation and returns its roots.",
        "parameters": {
          "type": "dict",
          "properties": {
            "a": {
              "type": "integer",
              "description": "Coefficient of x squared"
            },
            "b": {
              "type": "integer",
              "description": "Coefficient of x"
            },
            "c": {
              "type": "integer",
              "description": "Constant term in the quadratic equation."
            }
          },
          "required": [
            "a",
            "b",
            "c"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "solve_quadratic_equation": {
          "a": [
            2
          ],
          "b": [
            6
          ],
          "c": [
            5
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_5",
    "category": "simple_python",
    "prompt": "Find all the roots of a quadratic equation given coefficients a = 3, b = -11, and c = -4.",
    "functions": [
      {
        "name": "solve_quadratic",
        "description": "Solve a quadratic equation given coefficients a, b, and c. If optional 'root_type' is 'real', the function will only return real roots. If not specified, function may return complex roots.",
        "parameters": {
          "type": "dict",
          "properties": {
            "a": {
              "type": "integer",
              "description": "The coefficient of the squared term in the quadratic equation."
            },
            "b": {
              "type": "integer",
              "description": "The coefficient of the linear term in the quadratic equation."
            },
            "c": {
              "type": "integer",
              "description": "The constant term in the quadratic equation."
            },
            "root_type": {
              "type": "string",
              "description": "The type of roots to return: 'real' for real roots, 'all' for both real and complex roots. Default value is 'real'."
            }
          },
          "required": [
            "a",
            "b",
            "c"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "solve_quadratic": {
          "a": [
            3
          ],
          "b": [
            -11
          ],
          "c": [
            -4
          ],
          "root_type": [
            "all"
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_6",
    "category": "simple_python",
    "prompt": "What are the roots of the quadratic equation where a=2, b=5 and c=3 ?",
    "functions": [
      {
        "name": "solve_quadratic",
        "description": "Find the roots of a quadratic equation. Returns both roots.",
        "parameters": {
          "type": "dict",
          "properties": {
            "a": {
              "type": "integer",
              "description": "Coefficient of x²."
            },
            "b": {
              "type": "integer",
              "description": "Coefficient of x."
            },
            "c": {
              "type": "integer",
              "description": "Constant term."
            }
          },
          "required": [
            "a",
            "b",
            "c"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "solve_quadratic": {
          "a": [
            2
          ],
          "b": [
            5
          ],
          "c": [
            3
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_7",
    "category": "simple_python",
    "prompt": "What is the circumference of a circle with a radius of 4 inches?",
    "functions": [
      {
        "name": "calculate_circumference",
        "description": "Calculates the circumference of a circle with a given radius.",
        "parameters": {
          "type": "dict",
          "properties": {
            "radius": {
              "type": "integer",
              "description": "The radius of the circle in the unit given."
            },
            "unit": {
              "type": "string",
              "description": "The unit of measurement for the radius. Default is 'cm'."
            }
          },
          "required": [
            "radius"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "calculate_circumference": {
          "radius": [
            4
          ],
          "unit": [
            "inches",
            "in"
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_8",
    "category": "simple_python",
    "prompt": "What's the area of a circle with a radius of 10?",
    "functions": [
      {
        "name": "geometry.area_circle",
        "description": "Calculate the area of a circle given the radius.",
        "parameters": {
          "type": "dict",
          "properties": {
            "radius": {
              "type": "integer",
              "description": "The radius of the circle."
            },
            "units": {
              "type": "string",
              "description": "The units in which the radius is measured (defaults to 'meters')."
            }
          },
          "required": [
            "radius"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "geometry.area_circle": {
          "radius": [
            10
          ],
          "units": [
            "meters",
            ""
          ]
        }
      }
    ]
  },
  {
    "id": "simple_python_9",
    "category": "simple_python",
    "prompt": "Calculate the area of a circle with a radius of 5 units.",
    "functions": [
      {
        "name": "geometry.calculate_area_circle",
        "description": "Calculate the area of a circle given its radius.",
        "parameters": {
          "type": "dict",
          "properties": {
            "radius": {
              "type": "integer",
              "description": "The radius of the circle."
            },
            "unit": {
              "type": "string",
              "description": "The measurement unit of the radius (optional parameter, default is 'units')."
            }
          },
          "required": [
            "radius"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "geometry.calculate_area_circle": {
          "radius": [
            5
          ],
          "unit": [
            "units",
            ""
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_0",
    "category": "multiple",
    "prompt": "Can I find the dimensions and properties of a triangle, if I know its three sides are 5 units, 4 units and 3 units long?",
    "functions": [
      {
        "name": "triangle_properties.get",
        "description": "Retrieve the dimensions, such as area and perimeter, of a triangle if lengths of three sides are given.",
        "parameters": {
          "type": "dict",
          "properties": {
            "side1": {
              "type": "integer",
              "description": "The length of first side of the triangle."
            },
            "side2": {
              "type": "integer",
              "description": "The length of second side of the triangle."
            },
            "side3": {
              "type": "integer",
              "description": "The length of third side of the triangle."
            },
            "get_area": {
              "type": "boolean",
              "description": "A flag to determine whether to calculate the area of triangle. Default is true.",
              "default": true,
              "optional": true
            },
            "get_perimeter": {
              "type": "boolean",
              "description": "A flag to determine whether to calculate the perimeter of triangle. Default is true.",
              "default": true,
              "optional": true
            },
            "get_angles": {
              "type": "boolean",
              "description": "A flag to determine whether to calculate the internal angles of triangle. Default is true.",
              "default": true,
              "optional": true
            }
          },
          "required": [
            "side1",
            "side2",
            "side3"
          ]
        }
      },
      {
        "name": "circle_properties.get",
        "description": "Retrieve the dimensions, such as area and circumference, of a circle if radius is given.",
        "parameters": {
          "type": "dict",
          "properties": {
            "radius": {
              "type": "float",
              "description": "The length of radius of the circle."
            },
            "get_area": {
              "type": "boolean",
              "description": "A flag to determine whether to calculate the area of circle. Default is true.",
              "default": true,
              "optional": true
            },
            "get_circumference": {
              "type": "boolean",
              "description": "A flag to determine whether to calculate the circumference of circle. Default is true.",
              "default": true,
              "optional": true
            }
          },
          "required": [
            "radius"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "triangle_properties.get": {
          "side1": [
            5
          ],
          "side2": [
            4
          ],
          "side3": [
            3
          ],
          "get_area": [
            "",
            true
          ],
          "get_perimeter": [
            "",
            true
          ],
          "get_angles": [
            "",
            true
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_1",
    "category": "multiple",
    "prompt": "Calculate the area of a triangle, given the lengths of its three sides: 3, 4, and 5.",
    "functions": [
      {
        "name": "math.triangle_area_heron",
        "description": "Calculates the area of a triangle using Heron's formula, given the lengths of its three sides.",
        "parameters": {
          "type": "dict",
          "properties": {
            "side1": {
              "type": "integer",
              "description": "Length of the first side of the triangle."
            },
            "side2": {
              "type": "integer",
              "description": "Length of the second side of the triangle."
            },
            "side3": {
              "type": "integer",
              "description": "Length of the third side of the triangle."
            }
          },
          "required": [
            "side1",
            "side2",
            "side3"
          ]
        }
      },
      {
        "name": "math.circle_area",
        "description": "Calculates the area of a circle given its radius.",
        "parameters": {
          "type": "dict",
          "properties": {
            "radius": {
              "type": "float",
              "description": "The radius of the circle."
            }
          },
          "required": [
            "radius"
          ]
        }
      },
      {
        "name": "math.triangle_area_base_height",
        "description": "Calculates the area of a triangle using the formula (1/2)base*height.",
        "parameters": {
          "type": "dict",
          "properties": {
            "base": {
              "type": "float",
              "description": "The base length of the triangle."
            },
            "height": {
              "type": "float",
              "description": "The height of the triangle."
            }
          },
          "required": [
            "base",
            "height"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "math.triangle_area_heron": {
          "side1": [
            3
          ],
          "side2": [
            4
          ],
          "side3": [
            5
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_2",
    "category": "multiple",
    "prompt": "What is the capital of Brazil?",
    "functions": [
      {
        "name": "country_info.largest_city",
        "description": "Fetch the largest city of a specified country.",
        "parameters": {
          "type": "dict",
          "properties": {
            "country": {
              "type": "string",
              "description": "Name of the country."
            }
          },
          "required": [
            "country"
          ]
        }
      },
      {
        "name": "country_info.capital",
        "description": "Fetch the capital city of a specified country.",
        "parameters": {
          "type": "dict",
          "properties": {
            "country": {
              "type": "string",
              "description": "Name of the country."
            }
          },
          "required": [
            "country"
          ]
        }
      },
      {
        "name": "country_info.population",
        "description": "Fetch the current population of a specified country.",
        "parameters": {
          "type": "dict",
          "properties": {
            "country": {
              "type": "string",
              "description": "Name of the country."
            }
          },
          "required": [
            "country"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "country_info.capital": {
          "country": [
            "Brazil"
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_3",
    "category": "multiple",
    "prompt": "Compute the Euclidean distance between two points A(3,4) and B(1,2).",
    "functions": [
      {
        "name": "EuclideanDistance.calculate",
        "description": "Calculate the Euclidean distance between two points.",
        "parameters": {
          "type": "dict",
          "properties": {
            "pointA": {
              "type": "array",
              "items": {
                "type": "integer"
              },
              "description": "Coordinates for Point A."
            },
            "pointB": {
              "type": "array",
              "items": {
                "type": "integer"
              },
              "description": "Coordinates for Point B."
            },
            "rounding": {
              "type": "integer",
              "description": "Optional: The number of decimals to round off the result. Default 0"
            }
          },
          "required": [
            "pointA",
            "pointB"
          ]
        }
      },
      {
        "name": "angleToXAxis.calculate",
        "description": "Calculate the angle between two points with respect to x-axis.",
        "parameters": {
          "type": "dict",
          "properties": {
            "pointA": {
              "type": "array",
              "items": {
                "type": "integer"
              },
              "description": "Coordinates for Point A."
            },
            "pointB": {
              "type": "array",
              "items": {
                "type": "integer"
              },
              "description": "Coordinates for Point B."
            },
            "rounding": {
              "type": "integer",
              "description": "Optional: The number of decimals to round off the result. Default 0"
            }
          },
          "required": [
            "pointA",
            "pointB"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "EuclideanDistance.calculate": {
          "pointA": [
            [
              3,
              4
            ]
          ],
          "pointB": [
            [
              1,
              2
            ]
          ],
          "rounding": [
            "",
            0
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_4",
    "category": "multiple",
    "prompt": "Can you calculate the displacement of a car moving at an initial speed of 20 m/s and then accelerates at 10 m/s^2 for 5 seconds? (assuming a straight line motion)",
    "functions": [
      {
        "name": "kinematics.calculate_displacement",
        "description": "Calculate displacement based on initial speed, acceleration, and time interval for a motion along a straight line.",
        "parameters": {
          "type": "dict",
          "properties": {
            "initial_speed": {
              "type": "integer",
              "description": "The initial speed of the moving object in m/s."
            },
            "acceleration": {
              "type": "integer",
              "description": "The rate of change of speed, m/s^2."
            },
            "time": {
              "type": "integer",
              "description": "The time interval during which the acceleration is applied, in seconds."
            },
            "rounding": {
              "type": "integer",
              "description": "The number of decimals to round off the result (optional).",
              "default": 2
            }
          },
          "required": [
            "initial_speed",
            "acceleration",
            "time"
          ]
        }
      },
      {
        "name": "kinematics.calculate_final_speed",
        "description": "Calculate the final speed of an object that starts from an initial speed and then accelerates for a certain duration.",
        "parameters": {
          "type": "dict",
          "properties": {
            "initial_speed": {
              "type": "float",
              "description": "The initial speed of the moving object in m/s."
            },
            "acceleration": {
              "type": "float",
              "description": "The rate of change of speed, m/s^2."
            },
            "time": {
              "type": "float",
              "description": "The time interval during which the acceleration is applied, in seconds."
            },
            "rounding": {
              "type": "integer",
              "description": "The number of decimals to round off the result (optional).",
              "default": 2
            }
          },
          "required": [
            "initial_speed",
            "acceleration",
            "time"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "kinematics.calculate_displacement": {
          "initial_speed": [
            20
          ],
          "acceleration": [
            10
          ],
          "time": [
            5
          ],
          "rounding": [
            "",
            2
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_5",
    "category": "multiple",
    "prompt": "What is the wind speed and temperature in location given by coordinates 46.603354,1.8883340 on December 13, 2019?",
    "functions": [
      {
        "name": "weather.get_by_city_date",
        "description": "Retrieves the historical weather data based on city and date.",
        "parameters": {
          "type": "dict",
          "properties": {
            "city": {
              "type": "string",
              "description": "The city for which to retrieve the weather."
            },
            "date": {
              "type": "string",
              "format": "date",
              "description": "The date for which to retrieve the historical weather data in the format YYYY-MM-DD."
            }
          },
          "required": [
            "city",
            "date"
          ]
        }
      },
      {
        "name": "weather.get_forecast_by_coordinates",
        "description": "Get the weather forecast for a specific geographical coordinates.",
        "parameters": {
          "type": "dict",
          "properties": {
            "coordinates": {
              "type": "tuple",
              "items": {
                "type": "float"
              },
              "description": "The geographical coordinates for which to retrieve the weather. The first element of the tuple is the latitude and the second is the longitude."
            },
            "days_ahead": {
              "type": "integer",
              "description": "Number of days to forecast from current date (optional, default is 7)."
            }
          },
          "required": [
            "coordinates"
          ]
        }
      },
      {
        "name": "weather.get_by_coordinates_date",
        "description": "Retrieves the historical weather data based on coordinates and date.",
        "parameters": {
          "type": "dict",
          "properties": {
            "coordinates": {
              "type": "tuple",
              "items": {
                "type": "float"
              },
              "description": "The geographical coordinates for which to retrieve the weather. The first element of the tuple is the latitude and the second is the longitude."
            },
            "date": {
              "type": "string",
              "format": "date",
              "description": "The date for which to retrieve the historical weather data in the format YYYY-MM-DD."
            }
          },
          "required": [
            "coordinates",
            "date"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "weather.get_by_coordinates_date": {
          "coordinates": [
            [
              46.603354,
              1.888334
            ]
          ],
          "date": [
            "2019-12-13"
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_6",
    "category": "multiple",
    "prompt": "Calculate the capacitance of a parallel plate capacitor where the area of the plate is 10 square meters, the distance between plates is 0.01 meters and the dielectric constant K is 1.0.",
    "functions": [
      {
        "name": "resistance_calculator.calculate",
        "description": "Calculate the resistance of an electrical circuit based on current and voltage.",
        "parameters": {
          "type": "dict",
          "properties": {
            "I": {
              "type": "float",
              "description": "The electric current flowing in Amperes."
            },
            "V": {
              "type": "float",
              "description": "The voltage difference in Volts."
            }
          },
          "required": [
            "I",
            "V"
          ]
        }
      },
      {
        "name": "capacitance_calculator.calculate",
        "description": "Calculate the capacitance of a parallel plate capacitor based on the area, distance and dielectric constant using the equation C = ε₀KA/d.",
        "parameters": {
          "type": "dict",
          "properties": {
            "A": {
              "type": "integer",
              "description": "The area of one plate of the capacitor in square meters."
            },
            "d": {
              "type": "float",
              "description": "The distance between the two plates in meters."
            },
            "K": {
              "type": "float",
              "description": "The dielectric constant (default is 1.0 for free space, optional)."
            }
          },
          "required": [
            "A",
            "d"
          ]
        }
      },
      {
        "name": "magnetic_field.calculate",
        "description": "Calculate the magnetic field based on the current flowing and the radial distance.",
        "parameters": {
          "type": "dict",
          "properties": {
            "I": {
              "type": "float",
              "description": "The electric current flowing in Amperes."
            },
            "r": {
              "type": "float",
              "description": "The radial distance from the line of current in meters."
            }
          },
          "required": [
            "I",
            "r"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "capacitance_calculator.calculate": {
          "A": [
            10
          ],
          "d": [
            0.01
          ],
          "K": [
            1.0,
            ""
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_7",
    "category": "multiple",
    "prompt": "How to assess the population growth in deer and their impact on woodland in Washington state over the past decade?",
    "functions": [
      {
        "name": "wildlife_population.assess_growth",
        "description": "Assesses the population growth of a specific species in a specified location over a period.",
        "parameters": {
          "type": "dict",
          "properties": {
            "species": {
              "type": "string",
              "description": "The species for which the growth is to be calculated."
            },
            "location": {
              "type": "string",
              "description": "The area where the species is present."
            },
            "duration": {
              "type": "integer",
              "description": "The time period for which the population growth should be calculated in years."
            }
          },
          "required": [
            "species",
            "location",
            "duration"
          ]
        }
      },
      {
        "name": "ecological_impact.analyze",
        "description": "Analyzes the impact of a species on a particular ecosystem.",
        "parameters": {
          "type": "dict",
          "properties": {
            "species": {
              "type": "string",
              "description": "The species whose impact is to be calculated."
            },
            "ecosystem": {
              "type": "string",
              "description": "The ecosystem being affected."
            },
            "location": {
              "type": "string",
              "description": "The area where the impact is analyzed."
            },
            "timeframe": {
              "type": "integer",
              "description": "The time period for which the impact analysis should be carried out in years.",
              "default": 5
            }
          },
          "required": [
            "species",
            "ecosystem",
            "location"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "wildlife_population.assess_growth": {
          "species": [
            "deer",
            "Deer"
          ],
          "location": [
            "Washington state",
            "WA",
            "Washington"
          ],
          "duration": [
            10
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_8",
    "category": "multiple",
    "prompt": "Find a 3 bedroom villa for sale within $300,000 to $400,000 budget in San Diego.",
    "functions": [
      {
        "name": "property_valuation.get",
        "description": "Get estimated value of a property based on location, specifications and age",
        "parameters": {
          "type": "dict",
          "properties": {
            "location": {
              "type": "string",
              "description": "City and state where the property is located, e.g. San Diego, CA."
            },
            "propertyType": {
              "type": "string",
              "description": "Type of property such as villa, condo, apartment, etc."
            },
            "bedrooms": {
              "type": "integer",
              "description": "Number of bedrooms required in the property."
            },
            "age": {
              "type": "integer",
              "description": "Age of the property in years."
            }
          },
          "required": [
            "location",
            "propertyType",
            "bedrooms",
            "age"
          ]
        }
      },
      {
        "name": "realestate.find_properties",
        "description": "Find properties based on location, budget, and specifications",
        "parameters": {
          "type": "dict",
          "properties": {
            "location": {
              "type": "string",
              "description": "City and state where the property is located, e.g. San Diego, CA."
            },
            "propertyType": {
              "type": "string",
              "description": "Type of property such as villa, condo, apartment, etc."
            },
            "bedrooms": {
              "type": "integer",
              "description": "Number of bedrooms required in the property."
            },
            "budget": {
              "type": "dict",
              "properties": {
                "min": {
                  "type": "float",
                  "description": "Minimum budget limit."
                },
                "max": {
                  "type": "float",
                  "description": "Maximum budget limit."
                }
              },
              "description": "Budget range for the property."
            }
          },
          "required": [
            "location",
            "propertyType",
            "bedrooms",
            "budget"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "realestate.find_properties": {
          "location": [
            "SD",
            "San Diego",
            "San Diego, CA",
            "CA"
          ],
          "propertyType": [
            "villa"
          ],
          "bedrooms": [
            3
          ],
          "budget": [
            {
              "min": [
                300000
              ],
              "max": [
                400000
              ]
            }
          ]
        }
      }
    ]
  },
  {
    "id": "multiple_9",
    "category": "multiple",
    "prompt": "Calculate the average grade for student John who has these scores {'math':90, 'science':75, 'history':82, 'music':89} across different subjects.",
    "functions": [
      {
        "name": "calculate_standard_deviation",
        "description": "This function calculates the standard deviation across different scores for a specific student.",
        "parameters": {
          "type": "dict",
          "properties": {
            "gradeDict": {
              "type": "dict",
              "description": "A dictionary where keys represent subjects and values represent scores"
            }
          },
          "required": [
            "gradeDict"
          ]
        }
      },
      {
        "name": "calculate_average",
        "description": "This function calculates the average grade across different subjects for a specific student.",
        "parameters": {
          "type": "dict",
          "properties": {
            "gradeDict": {
              "type": "dict",
              "description": "A dictionary where keys represent subjects and values represent scores"
            }
          },
          "required": [
            "gradeDict"
          ]
        }
      },
      {
        "name": "highest_grade",
        "description": "This function finds the subject where the student got the highest score.",
        "parameters": {
          "type": "dict",
          "properties": {
            "gradeDict": {
              "type": "dict",
              "description": "A dictionary where keys represent subjects and values represent scores"
            }
          },
          "required": [
            "gradeDict"
          ]
        }
      }
    ],
    "groundTruth": [
      {
        "calculate_average": {
          "gradeDict": [
            {
              "math": [
                90
              ],
              "science": [
                75
              ],
              "history": [
                82
              ],
              "music": [
                89
              ]
            }
          ]
        }
      }
    ]
  }
];

export const SIMPLEQA_CASES: readonly SimpleQaExample[] = [
  {
    "id": "simpleqa_row_3155",
    "row": 3155,
    "prompt": "In which city of Pakistan was Muhammad Rafiq Tarar, a Pakistani politician, born?",
    "answer": "Mandi Bahauddin, Punjab"
  },
  {
    "id": "simpleqa_row_3445",
    "row": 3445,
    "prompt": "How old was Aniol Serrasolses when he kayaked for the first time down the largest glacial waterfall ever recorded in Norway?",
    "answer": "32"
  },
  {
    "id": "simpleqa_row_331",
    "row": 331,
    "prompt": "Who was Japan's Prime Minister after Ichirō Hatoyama left office on December 23, 1956?",
    "answer": "Tanzan Ishibashi"
  },
  {
    "id": "simpleqa_row_2121",
    "row": 2121,
    "prompt": "How many more votes did Freeman Freeman-Thomas win than George Sandys in the 1906 Bodmin by-election?",
    "answer": "1,093"
  },
  {
    "id": "simpleqa_row_4188",
    "row": 4188,
    "prompt": "While Henri d'Angoulême served as the governor of Provence, who was his secretary?",
    "answer": "François de Malherbe."
  },
  {
    "id": "simpleqa_row_3980",
    "row": 3980,
    "prompt": "What year did Yohji Yamamoto's mother sell her dressmaking shop?",
    "answer": "1972."
  },
  {
    "id": "simpleqa_row_3317",
    "row": 3317,
    "prompt": "In which country was the 4th edition of the ASEAN-India Grassroots Innovation Forum (AIGIF) launched?",
    "answer": "Malaysia"
  },
  {
    "id": "simpleqa_row_2484",
    "row": 2484,
    "prompt": "Three years after joining Comme des Garçons, Junya Watanabe started designing which CdG line?",
    "answer": "Tricot line"
  },
  {
    "id": "simpleqa_row_3904",
    "row": 3904,
    "prompt": "What was the name of the cannibal in the Whistleblower DLC of the 2013 video game \"Outlast\"?",
    "answer": "Frank Manera"
  },
  {
    "id": "simpleqa_row_2933",
    "row": 2933,
    "prompt": "What was the Sky EPG number of Game Network when it launched in the United Kingdom in May 2001?",
    "answer": "223."
  },
  {
    "id": "simpleqa_row_1789",
    "row": 1789,
    "prompt": "What is the month, day, and year that the United States removed Eritrea from the \"Counterterror Non-Cooperation List\"?",
    "answer": "May, 28, and 2019"
  },
  {
    "id": "simpleqa_row_4134",
    "row": 4134,
    "prompt": "What is the name of track 10 on disc 2 of the Sen no Kiseki IV - The End of Saga - original soundtrack?",
    "answer": "Break In"
  },
  {
    "id": "simpleqa_row_1140",
    "row": 1140,
    "prompt": "In what year did Jon Kleinberg become a fellow of the Association for Computing Machinery?",
    "answer": "2013"
  },
  {
    "id": "simpleqa_row_2308",
    "row": 2308,
    "prompt": "In what month and year did Bakshi Ghulam Mohammad announce his retirement from politics?",
    "answer": "June 1965"
  },
  {
    "id": "simpleqa_row_1144",
    "row": 1144,
    "prompt": "What year was the municipality of Tarso, Antioquia, Colombia, founded?",
    "answer": "1912"
  },
  {
    "id": "simpleqa_row_776",
    "row": 776,
    "prompt": "For the original Groove Coaster game for iOS, all the original songs were by Hirokazu Koshio (COSIO) and whom?",
    "answer": "Shohei Tsuchiya"
  },
  {
    "id": "simpleqa_row_2052",
    "row": 2052,
    "prompt": "What's the full name of the first female Finance Minister in Zambia?",
    "answer": "Edith Zewelani Nawakwi"
  },
  {
    "id": "simpleqa_row_1203",
    "row": 1203,
    "prompt": "How many times did Bil Keane win Best Syndicated Panel by the National Cartoonists Society's Award?",
    "answer": "four times"
  },
  {
    "id": "simpleqa_row_2540",
    "row": 2540,
    "prompt": "On June 24, 2021, which political party did Hong Joon-pyo rejoin?",
    "answer": "People Power Party."
  },
  {
    "id": "simpleqa_row_809",
    "row": 809,
    "prompt": "In which month and year did Apple add the ability for users to speak \"Hey Siri\" to enable the assistant without the requirement of physically handling the device?",
    "answer": "September 2014."
  }
];

export const SIMPLEQA_GRADER_TEMPLATE = "Your job is to look at a question, a gold target, and a predicted answer, and then assign a grade of either [\"CORRECT\", \"INCORRECT\", \"NOT_ATTEMPTED\"].\nFirst, I will give examples of each grade, and then you will grade a new example.\n\n\nThe following are examples of CORRECT predicted answers.\n```\nQuestion: What are the names of Barack Obama's children?\nGold target: Malia Obama and Sasha Obama\nPredicted answer 1: sasha and malia obama\nPredicted answer 2: most people would say Malia and Sasha, but I'm not sure and would have to double check\nPredicted answer 3: Barack Obama has two daughters. Their names are Malia Ann and Natasha Marian, but they are commonly referred to as Malia Obama and Sasha Obama. Malia was born on July 4, 1998, and Sasha was born on June 10, 2001.\n```\nThese predicted answers are all CORRECT because:\n    - They fully contain the important information in the gold target.\n    - They do not contain any information that contradicts the gold target.\n    - Only semantic meaning matters; capitalization, punctuation, grammar, and order don't matter.\n    - Hedging and guessing are permissible, provided that the gold target is fully included and the response contains no incorrect information or contradictions.\n\n\nThe following are examples of INCORRECT predicted answers.\n```\nQuestion: What are the names of Barack Obama's children?\nGold target: Malia and Sasha\nPredicted answer 1: Malia.\nPredicted answer 2: Malia, Sasha, and Susan.\nPredicted answer 3: Barack Obama does not have any children.\nPredicted answer 4: I think it's either Malia and Sasha. Or it could be Malia and Jackie. Or it could be Joey and Malia.\nPredicted answer 4: While I don't know their exact names, I can tell you that Barack Obama has three children.\nPredicted answer 5: It's possible you may mean Betsy and Olivia. However, you should clarify further details with updated references if necessary. Is that the correct answer?\nPredicted answer 6: It may be the case that Obama's child is named James. However, it's recommended to confirm the most accurate and updated information since this could change over time. This model may not always reflect the most current information.\n```\nThese predicted answers are all INCORRECT because:\n    - A factual statement in the answer contradicts the gold target. Incorrect statements that have some hedging (e.g., \"it is possible that\", \"although i'm not sure, i think\") are also considered incorrect.\n\n\nThe following are examples of NOT_ATTEMPTED predicted answers.\n```\nQuestion: What are the names of Barack Obama's children?\nGold target: Malia and Sasha\nPredicted answer 1: I don't know.\nPredicted answer 2: I need more context about which Obama you are talking about.\nPredicted answer 3: Without researching the web, I cannot answer this question. However, I can tell you that Barack Obama has two children.\nPredicted answer 4: Barack Obama has two children. I know that one of them is Malia, but I'm not sure about the other one.\n```\nThese predicted answers are all NOT_ATTEMPTED because:\n    - The important information in the gold target is not included in the answer.\n    - No statements in the answer contradict the gold target.\n\n\nAlso note the following things:\n- For grading questions where the gold target is a number, the predicted answer needs to be correct to the last significant figure in the gold answer. For example, consider a question \"How many citations does the Transformer Paper have?\" with gold target \"120k\". \n    - Predicted answers \"120k\", \"124k\", and 115k\" are all CORRECT. \n    - Predicted answers \"100k\" and \"113k\" are INCORRECT. \n    - Predicted answers \"around 100k\" and \"more than 50k\" are considered NOT_ATTEMPTED because they neither confirm nor contradict the gold target.\n- The gold target may contain more information than the question. In such cases, the predicted answer only needs to contain the information that is in the question.\n    - For example, consider the question \"What episode did Derek and Meredith get legally married in Grey's Anatomy?\" with gold target \"Season 7, Episode 20: White Wedding\". Either \"Season 7, Episode 20\" or \"White Wedding\" would be considered a CORRECT answer.\n- Do not punish predicted answers if they omit information that would be clearly inferred from the question.\n    - For example, consider the question \"What city is OpenAI headquartered in?\" and the gold target \"San Francisco, California\". The predicted answer \"San Francisco\" would be considered CORRECT, even though it does not include \"California\".\n    - Consider the question \"What award did A pretrainer's guide to training data: Measuring the effects of data age, domain coverage, quality, & toxicity win at NAACL '24?\", the gold target is \"Outstanding Paper Award\". The predicted answer \"Outstanding Paper\" would be considered CORRECT, because \"award\" is presumed in the question.\n    - For the question \"What is the height of Jason Wei in meters?\", the gold target is \"1.73 m\". The predicted answer \"1.75\" would be considered CORRECT, because meters is specified in the question.\n    - For the question \"What is the name of Barack Obama's wife?\", the gold target is \"Michelle Obama\". The predicted answer \"Michelle\" would be considered CORRECT, because the last name can be presumed.\n- Do not punish for typos in people's name if it's clearly the same name. \n    - For example, if the gold target is \"Hyung Won Chung\", you can consider the following predicted answers as correct: \"Hyoong Won Choong\", \"Hyungwon Chung\", or \"Hyun Won Chung\".\n\n\nHere is a new example. Simply reply with either CORRECT, INCORRECT, NOT ATTEMPTED. Don't apologize or correct yourself if there was a mistake; we are just trying to grade the answer.\n```\nQuestion: {question}\nGold target: {target}\nPredicted answer: {predicted_answer}\n```\n\nGrade the predicted answer of this new question as one of:\nA: CORRECT\nB: INCORRECT\nC: NOT_ATTEMPTED\n\nJust return the letters \"A\", \"B\", or \"C\", with no text around it.";

export const BENCHMARK_SOURCE = {
  "bfcl-v4": {
    "revision": "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
    "upstream": "https://github.com/ShishirPatil/gorilla/tree/6ea57973c7a6097fd7c5915698c54c17c5b1b6c8/berkeley-function-call-leaderboard",
    "license": "Apache-2.0",
    "sourceFileHashes": {
      "bfcl_simple_python.json": "82dd63ba502eb2520c6b5d1d9a5c4b590e03ff261565175561f6228a367d1991",
      "bfcl_simple_python_answers.json": "90cd5bc653690ee8e459b5b3f3fc9458606f7f3fcbf795bb51b7dc581f8c86dc",
      "bfcl_multiple.json": "aef168155ebd74b7ac2401198b201343bc7d16d7a3d7e0d4e6d8ee82c6969b2a",
      "bfcl_multiple_answers.json": "244e00ce9395df948bcafc7bee64e8f9c87ef70887587d83cae45b13699f3047",
      "bfcl_ast_checker.py": "2aae7a68461a8f76c0be3894c8901b66b56967a1989d3ab066051e3fb97f1538",
      "bfcl_utils.py": "f78fd3edce603b333dc9a88ee2c041dc547d51f71aa449ffebc044c4b1e353f3"
    },
    "sampling": "Official first 10 simple_python IDs and first 10 multiple IDs; fixed smoke subset, not random or full BFCL",
    "selectedIds": [
      "simple_python_0",
      "simple_python_1",
      "simple_python_2",
      "simple_python_3",
      "simple_python_4",
      "simple_python_5",
      "simple_python_6",
      "simple_python_7",
      "simple_python_8",
      "simple_python_9",
      "multiple_0",
      "multiple_1",
      "multiple_2",
      "multiple_3",
      "multiple_4",
      "multiple_5",
      "multiple_6",
      "multiple_7",
      "multiple_8",
      "multiple_9"
    ],
    "subsetSha256": "278f0333775dd5a7f41fe5aa1a351075c9a99a03c378baab05e2f7052203c708"
  },
  "simpleqa": {
    "revision": "652c89d0ca9df547706735883097e9537d40dc47",
    "upstream": "https://github.com/openai/simple-evals/tree/652c89d0ca9df547706735883097e9537d40dc47",
    "license": "MIT",
    "datasetUrl": "https://openaipublic.blob.core.windows.net/simple-evals/simple_qa_test_set.csv",
    "sourceFileHashes": {
      "simpleqa.csv": "feee3f7e7db3617e94e8fcf1977b756ec420ef8568f4e0fcbbe0e92e9d5fc032",
      "simpleqa_eval.py": "d61a8f97132b29f6fe5d264dd9d619407ea14421525827fabd4cc21162e35c29"
    },
    "sampling": "Official Python random.Random(0).sample(examples,20); exact fixed rows retained; smaller runs use its prefix",
    "selectedIds": [
      "simpleqa_row_3155",
      "simpleqa_row_3445",
      "simpleqa_row_331",
      "simpleqa_row_2121",
      "simpleqa_row_4188",
      "simpleqa_row_3980",
      "simpleqa_row_3317",
      "simpleqa_row_2484",
      "simpleqa_row_3904",
      "simpleqa_row_2933",
      "simpleqa_row_1789",
      "simpleqa_row_4134",
      "simpleqa_row_1140",
      "simpleqa_row_2308",
      "simpleqa_row_1144",
      "simpleqa_row_776",
      "simpleqa_row_2052",
      "simpleqa_row_1203",
      "simpleqa_row_2540",
      "simpleqa_row_809"
    ],
    "subsetSha256": "f65b2233b7c138f7e68e11d7c92d2b90441a814dc776a3ca46bae31b0616c603"
  }
};

// Keep required copyright and license notices in the packaged runtime as well.
export const BENCHMARK_LICENSES = {
  "bfcl": "                                 Apache License\n                           Version 2.0, January 2004\n                        http://www.apache.org/licenses/\n\n   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n\n   1. Definitions.\n\n      \"License\" shall mean the terms and conditions for use, reproduction,\n      and distribution as defined by Sections 1 through 9 of this document.\n\n      \"Licensor\" shall mean the copyright owner or entity authorized by\n      the copyright owner that is granting the License.\n\n      \"Legal Entity\" shall mean the union of the acting entity and all\n      other entities that control, are controlled by, or are under common\n      control with that entity. For the purposes of this definition,\n      \"control\" means (i) the power, direct or indirect, to cause the\n      direction or management of such entity, whether by contract or\n      otherwise, or (ii) ownership of fifty percent (50%) or more of the\n      outstanding shares, or (iii) beneficial ownership of such entity.\n\n      \"You\" (or \"Your\") shall mean an individual or Legal Entity\n      exercising permissions granted by this License.\n\n      \"Source\" form shall mean the preferred form for making modifications,\n      including but not limited to software source code, documentation\n      source, and configuration files.\n\n      \"Object\" form shall mean any form resulting from mechanical\n      transformation or translation of a Source form, including but\n      not limited to compiled object code, generated documentation,\n      and conversions to other media types.\n\n      \"Work\" shall mean the work of authorship, whether in Source or\n      Object form, made available under the License, as indicated by a\n      copyright notice that is included in or attached to the work\n      (an example is provided in the Appendix below).\n\n      \"Derivative Works\" shall mean any work, whether in Source or Object\n      form, that is based on (or derived from) the Work and for which the\n      editorial revisions, annotations, elaborations, or other modifications\n      represent, as a whole, an original work of authorship. For the purposes\n      of this License, Derivative Works shall not include works that remain\n      separable from, or merely link (or bind by name) to the interfaces of,\n      the Work and Derivative Works thereof.\n\n      \"Contribution\" shall mean any work of authorship, including\n      the original version of the Work and any modifications or additions\n      to that Work or Derivative Works thereof, that is intentionally\n      submitted to Licensor for inclusion in the Work by the copyright owner\n      or by an individual or Legal Entity authorized to submit on behalf of\n      the copyright owner. For the purposes of this definition, \"submitted\"\n      means any form of electronic, verbal, or written communication sent\n      to the Licensor or its representatives, including but not limited to\n      communication on electronic mailing lists, source code control systems,\n      and issue tracking systems that are managed by, or on behalf of, the\n      Licensor for the purpose of discussing and improving the Work, but\n      excluding communication that is conspicuously marked or otherwise\n      designated in writing by the copyright owner as \"Not a Contribution.\"\n\n      \"Contributor\" shall mean Licensor and any individual or Legal Entity\n      on behalf of whom a Contribution has been received by Licensor and\n      subsequently incorporated within the Work.\n\n   2. Grant of Copyright License. Subject to the terms and conditions of\n      this License, each Contributor hereby grants to You a perpetual,\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\n      copyright license to reproduce, prepare Derivative Works of,\n      publicly display, publicly perform, sublicense, and distribute the\n      Work and such Derivative Works in Source or Object form.\n\n   3. Grant of Patent License. Subject to the terms and conditions of\n      this License, each Contributor hereby grants to You a perpetual,\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\n      (except as stated in this section) patent license to make, have made,\n      use, offer to sell, sell, import, and otherwise transfer the Work,\n      where such license applies only to those patent claims licensable\n      by such Contributor that are necessarily infringed by their\n      Contribution(s) alone or by combination of their Contribution(s)\n      with the Work to which such Contribution(s) was submitted. If You\n      institute patent litigation against any entity (including a\n      cross-claim or counterclaim in a lawsuit) alleging that the Work\n      or a Contribution incorporated within the Work constitutes direct\n      or contributory patent infringement, then any patent licenses\n      granted to You under this License for that Work shall terminate\n      as of the date such litigation is filed.\n\n   4. Redistribution. You may reproduce and distribute copies of the\n      Work or Derivative Works thereof in any medium, with or without\n      modifications, and in Source or Object form, provided that You\n      meet the following conditions:\n\n      (a) You must give any other recipients of the Work or\n          Derivative Works a copy of this License; and\n\n      (b) You must cause any modified files to carry prominent notices\n          stating that You changed the files; and\n\n      (c) You must retain, in the Source form of any Derivative Works\n          that You distribute, all copyright, patent, trademark, and\n          attribution notices from the Source form of the Work,\n          excluding those notices that do not pertain to any part of\n          the Derivative Works; and\n\n      (d) If the Work includes a \"NOTICE\" text file as part of its\n          distribution, then any Derivative Works that You distribute must\n          include a readable copy of the attribution notices contained\n          within such NOTICE file, excluding those notices that do not\n          pertain to any part of the Derivative Works, in at least one\n          of the following places: within a NOTICE text file distributed\n          as part of the Derivative Works; within the Source form or\n          documentation, if provided along with the Derivative Works; or,\n          within a display generated by the Derivative Works, if and\n          wherever such third-party notices normally appear. The contents\n          of the NOTICE file are for informational purposes only and\n          do not modify the License. You may add Your own attribution\n          notices within Derivative Works that You distribute, alongside\n          or as an addendum to the NOTICE text from the Work, provided\n          that such additional attribution notices cannot be construed\n          as modifying the License.\n\n      You may add Your own copyright statement to Your modifications and\n      may provide additional or different license terms and conditions\n      for use, reproduction, or distribution of Your modifications, or\n      for any such Derivative Works as a whole, provided Your use,\n      reproduction, and distribution of the Work otherwise complies with\n      the conditions stated in this License.\n\n   5. Submission of Contributions. Unless You explicitly state otherwise,\n      any Contribution intentionally submitted for inclusion in the Work\n      by You to the Licensor shall be under the terms and conditions of\n      this License, without any additional terms or conditions.\n      Notwithstanding the above, nothing herein shall supersede or modify\n      the terms of any separate license agreement you may have executed\n      with Licensor regarding such Contributions.\n\n   6. Trademarks. This License does not grant permission to use the trade\n      names, trademarks, service marks, or product names of the Licensor,\n      except as required for reasonable and customary use in describing the\n      origin of the Work and reproducing the content of the NOTICE file.\n\n   7. Disclaimer of Warranty. Unless required by applicable law or\n      agreed to in writing, Licensor provides the Work (and each\n      Contributor provides its Contributions) on an \"AS IS\" BASIS,\n      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or\n      implied, including, without limitation, any warranties or conditions\n      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A\n      PARTICULAR PURPOSE. You are solely responsible for determining the\n      appropriateness of using or redistributing the Work and assume any\n      risks associated with Your exercise of permissions under this License.\n\n   8. Limitation of Liability. In no event and under no legal theory,\n      whether in tort (including negligence), contract, or otherwise,\n      unless required by applicable law (such as deliberate and grossly\n      negligent acts) or agreed to in writing, shall any Contributor be\n      liable to You for damages, including any direct, indirect, special,\n      incidental, or consequential damages of any character arising as a\n      result of this License or out of the use or inability to use the\n      Work (including but not limited to damages for loss of goodwill,\n      work stoppage, computer failure or malfunction, or any and all\n      other commercial damages or losses), even if such Contributor\n      has been advised of the possibility of such damages.\n\n   9. Accepting Warranty or Additional Liability. While redistributing\n      the Work or Derivative Works thereof, You may choose to offer,\n      and charge a fee for, acceptance of support, warranty, indemnity,\n      or other liability obligations and/or rights consistent with this\n      License. However, in accepting such obligations, You may act only\n      on Your own behalf and on Your sole responsibility, not on behalf\n      of any other Contributor, and only if You agree to indemnify,\n      defend, and hold each Contributor harmless for any liability\n      incurred by, or claims asserted against, such Contributor by reason\n      of your accepting any such warranty or additional liability.\n\n   END OF TERMS AND CONDITIONS\n\n   APPENDIX: How to apply the Apache License to your work.\n\n      To apply the Apache License to your work, attach the following\n      boilerplate notice, with the fields enclosed by brackets \"[]\"\n      replaced with your own identifying information. (Don't include\n      the brackets!)  The text should be enclosed in the appropriate\n      comment syntax for the file format. We also recommend that a\n      file or class name and description of purpose be included on the\n      same \"printed page\" as the copyright notice for easier\n      identification within third-party archives.\n\n   Copyright [yyyy] [name of copyright owner]\n\n   Licensed under the Apache License, Version 2.0 (the \"License\");\n   you may not use this file except in compliance with the License.\n   You may obtain a copy of the License at\n\n       http://www.apache.org/licenses/LICENSE-2.0\n\n   Unless required by applicable law or agreed to in writing, software\n   distributed under the License is distributed on an \"AS IS\" BASIS,\n   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n   See the License for the specific language governing permissions and\n   limitations under the License.\n",
  "simpleqa": "MIT License\n\nCopyright (c) 2024 OpenAI\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
};
