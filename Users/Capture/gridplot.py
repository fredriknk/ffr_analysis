import pandas as pd
import matplotlib.pyplot as plt
plt.ioff()
import numpy as np
from time import time
from multiprocessing import Pool
from scipy import interpolate
from math import sqrt,floor,ceil


def toDf(filename="capture_slopes.xls",date_column = "date"):
    df = pd.read_excel(filename)
    return df

def plotDF(dt,subgroup,gas,params,ax, title):
    if "I" in params:  # Interpolate missing values
        dt = dt.interpolate()

    if "A" in params:  # average and get info (std_div, min values, max values
        dx = dt[gas]

        mean_v = dx.groupby(dx.index.date).mean()  # .interpolate(method="spline")
        std_dev = dx.groupby(dx.index.date).std()
        min_v = dx.groupby(dx.index.date).min()
        max_v = dx.groupby(dx.index.date).max()

        mean_v.plot(title = title,ax=ax)

        color = "blue"
        if "S" in params:
            ax.fill_between(std_dev.index, mean_v + std_dev, mean_v - std_dev, color=color,
                                                   alpha=0.2)
            color = "red"
        if "X" in params:
            ax.fill_between(min_v.index, min_v, max_v, color=color, alpha=0.2)
            color = "green"
    if "R" in params:  # If not average, just print all plots individually
        dt.groupby([subgroup])[gas].plot(title = title,ax=ax )

    return ax

def plotDF_wrapper(args):
   return plotDF(*args)

def matrixplot(df,
               plotcolumns = ["N2O_N_mug_m2h", "CO2_C_mug_m2h"],
               group1 ="treatment",
               subgroup ='nr',
               params = "ASI",
               figsize=(20, 15)):
    # A = Average, S = Stdev, I = Interpolate, R = Regular (all graphs superimposed) X = Minmax

    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date')

    nPlots = len(df[group1].unique())

    fig, axs = plt.subplots(nrows=len(plotcolumns), ncols=nPlots, figsize=figsize, sharex=True,
                            sharey='row')  # ,sharey=True)

    for i_gas, gas in enumerate(plotcolumns):
        axs[i_gas, 0].set_ylabel(gas)



        for treatment in np.sort(df[group1].unique()):

            if i_gas == 0:
                title = treatment
            else:
                title = ""

            dt = df[df[group1] == treatment]
            axs[i_gas, treatment - 1] = plotDF(dt,subgroup,gas,params,axs[i_gas, treatment - 1],title)

    fig.autofmt_xdate(rotation=70)
    plt.tight_layout()
    plt.subplots_adjust(wspace=0, hspace=0)
    plt.show()

if __name__ == "__main__":
    start = time()
    filename = "output/capture_slopes.xls"  #filename for raw output
    plotcolumns = ["N2O_N_mug_m2h", "CO2_C_mug_m2h"] #the collumns in the excel document to be parsed
    group1 = "treatment" # The first group to sort output by
    subgroup = 'nr' # the second group to sort output by
    params = "ASIX" # A = Average, S = Stdev, I = Interpolate, R = Regular (all graphs superimposed) X = Minmax
    figsize = (15, 12)

    df = toDf(filename)

    matrixplot(df,
               plotcolumns ,
               group1,
               subgroup,
               params,
               figsize)
